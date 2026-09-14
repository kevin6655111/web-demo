import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { Project, type ProjectState } from './entities/project.entity';
import { CompanyProject } from './entities/company-project.entity';
import { ProjectVehicle } from './entities/project-vehicle.entity';
import { ProjectSection } from './entities/project-section.entity';
import { Section } from './entities/section.entity';
import { SectionArea } from './entities/section-area.entity';
import { Area } from './entities/area.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { CreateProjectDto, ProjectQueryDto, UpdateProjectStateDto, UpsertProjectRelationDto } from './project.dto';

/**
 * 標案清單的快取。
 *
 * TTL 短（60 秒）而非長：清單帶有案件統計，那個數字持續變動。
 * 短 TTL 讓統計的落差有上界，而標案本身的變動由寫入時的明確清除處理。
 */
const PROJECT_CACHE_PREFIX = 'project:list:';
const PROJECT_CACHE_TTL_MS = 60_000;

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(CompanyProject) private readonly companyProjectRepo: Repository<CompanyProject>,
    @InjectRepository(ProjectVehicle) private readonly projectVehicleRepo: Repository<ProjectVehicle>,
    @InjectRepository(ProjectSection) private readonly projectSectionRepo: Repository<ProjectSection>,
    @InjectRepository(Section) private readonly sectionRepo: Repository<Section>,
    @InjectRepository(SectionArea) private readonly sectionAreaRepo: Repository<SectionArea>,
    @InjectRepository(Area) private readonly areaRepo: Repository<Area>,
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService
  ) {}

  /**
   * 標案清單。
   *
   * 只列出「這間公司有參與的」標案 —— 透過 company_project 關聯而不是直接欄位，
   * 因為一個標案可能由主辦與協力廠商共同執行。
   *
   * 一併帶出案件數與完修率，承辦不必為了看進度再點進去。
   */
  public async list(dto: ProjectQueryDto, companyId: number): Promise<HttpResult> {
    // 標案本身極少變動，但這支端點一併帶出案件統計，而那段聚合的成本
    // 隨案件數線性成長（1,800 筆時 0.4 ms，9 萬筆時 15 ms），
    // 且標案下拉出現在多個畫面上，每次開啟都會呼叫。
    //
    // 快取整個回應而非只快取統計：查詢條件的組合會影響結果，
    // 分開快取要處理兩者的一致性，而合起來只是多存幾份小 JSON。
    const cacheKey = `${PROJECT_CACHE_PREFIX}${companyId}:${JSON.stringify(dto)}`;

    // 只加在信封層，不要動 data —— 這裡的 data 是陣列，
    // 用物件展開會把它變成 { 0: ..., 1: ... }，前端的 .map() 直接爆掉
    const { value, cached } = await this.redisService.remember(cacheKey, PROJECT_CACHE_TTL_MS, () =>
      this.computeList(dto, companyId)
    );

    return cached ? { ...value, cached: true } : value;
  }

  private async computeList(dto: ProjectQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.projectRepo
      .createQueryBuilder('p')
      .innerJoin('p.companyProjects', 'cp', 'cp.company_id = :companyId AND cp.is_active = true', { companyId })
      .orderBy('p.id', 'DESC');

    if (dto.PRJ_ID) qb.andWhere('p.prj_id ILIKE :prjId', { prjId: `%${dto.PRJ_ID}%` });
    if (dto.KEYWORD)
      qb.andWhere('(p.prj_name ILIKE :kw OR p.prj_main ILIKE :kw OR p.proprietor ILIKE :kw)', {
        kw: `%${dto.KEYWORD}%`
      });
    if (dto.STATE?.length) qb.andWhere('p.state IN (:...state)', { state: dto.STATE });
    if (dto.PROPRIETOR_LEVEL?.length) qb.andWhere('p.proprietor_level IN (:...level)', { level: dto.PROPRIETOR_LEVEL });
    if (dto.DATE_FROM) qb.andWhere('p.end_date >= :from', { from: dto.DATE_FROM });
    if (dto.DATE_TO) qb.andWhere('p.start_date <= :to', { to: dto.DATE_TO });
    // 「執行中」看的是日期而不是狀態欄位：狀態可能忘記改，日期不會
    if (dto.CURRENT) qb.andWhere('CURRENT_DATE BETWEEN p.start_date AND p.end_date');

    const projects = await qb.getMany();
    if (!projects.length) return HttpResponse.warn({ data: [], message: '查無標案' });

    // 統計一次查完再合併，不要在迴圈裡逐筆查(N+1)
    const stats = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoin('c.status', 'st')
      .select('c.project_id', 'projectId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect('COUNT(*) FILTER (WHERE st.need_repair = 2)::int', 'dispatched')
      .addSelect('COUNT(*) FILTER (WHERE st.status = 1)::int', 'passed')
      .where('c.project_id IN (:...ids)', { ids: projects.map((p) => p.id) })
      .groupBy('c.project_id')
      .getRawMany<{ projectId: number; total: number; dispatched: number; passed: number }>();

    const byProject = new Map(stats.map((s) => [Number(s.projectId), s]));

    return HttpResponse.success({
      data: projects.map((p) => {
        const s = byProject.get(p.id);
        const total = s?.total ?? 0;

        return {
          ID: p.id,
          PRJ_ID: p.prjId,
          PRJ_NO: p.prjNo ?? null,
          PRJ_NAME: p.prjName,
          PRJ_MAIN: p.prjMain,
          PRJ_SUB: p.prjSub ?? null,
          PROPRIETOR: p.proprietor,
          PROPRIETOR_LEVEL: p.proprietorLevel,
          STATE: p.state,
          START_DATE: p.startDate,
          END_DATE: p.endDate,
          BUDGET: Number(p.budget),
          ROAD_KM: Number(p.roadKm),
          CASE_TOTAL: total,
          CASE_PASSED: s?.passed ?? 0,
          CASE_DISPATCHED: s?.dispatched ?? 0,
          DISPATCH_RATE: total ? Math.round(((s?.dispatched ?? 0) / total) * 100) : 0
        };
      })
    });
  }

  /** 標案詳情：含關聯的公司、車輛、工務段與轄區 */
  public async getById(id: number, companyId: number): Promise<HttpResult> {
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`找不到標案：${id}`);

    const [companies, vehicles, sections] = await Promise.all([
      this.companyProjectRepo.find({ where: { project: { id } }, relations: { company: true } }),
      this.projectVehicleRepo.find({ where: { project: { id } }, relations: { vehicle: true } }),
      this.projectSectionRepo.find({
        where: { project: { id } },
        relations: { section: true, sectionAreas: { area: true } }
      })
    ]);

    return HttpResponse.success({
      data: {
        ID: project.id,
        PRJ_ID: project.prjId,
        PRJ_NO: project.prjNo ?? null,
        PRJ_NAME: project.prjName,
        PRJ_MAIN: project.prjMain,
        PRJ_SUB: project.prjSub ?? null,
        PROPRIETOR: project.proprietor,
        PROPRIETOR_LEVEL: project.proprietorLevel,
        STATE: project.state,
        START_DATE: project.startDate,
        END_DATE: project.endDate,
        BUDGET: Number(project.budget),
        ROAD_KM: Number(project.roadKm),
        COMPANIES: companies.map((c) => ({
          ID: c.company.id,
          CODE: c.company.code,
          NAME: c.company.name,
          ROLE: c.role,
          IS_ACTIVE: c.isActive
        })),
        VEHICLES: vehicles.map((v) => ({ ID: v.vehicle.id, PLATE_NO: v.vehicle.plateNo, IS_ACTIVE: v.isActive })),
        SECTIONS: sections.map((ps) => ({
          ID: ps.id,
          SECTION_ID: ps.section?.id ?? null,
          SECTION_NAME: ps.section?.name ?? null,
          IS_ACTIVE: ps.isActive,
          AREAS: (ps.sectionAreas ?? []).map((sa) => ({
            ID: sa.area?.id ?? null,
            COUNTY: sa.area?.county,
            DISTRICT: sa.area?.district
          }))
        }))
      }
    });
  }

  /** 新增標案；建立時一併掛上目前公司的關聯 */
  public async create(dto: CreateProjectDto, companyId: number): Promise<HttpResult> {
    if (await this.projectRepo.exists({ where: { prjId: dto.PRJ_ID } })) {
      throw new ConflictException(`標案號已存在：${dto.PRJ_ID}`);
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const project = await manager.getRepository(Project).save(
        manager.getRepository(Project).create({
          prjId: dto.PRJ_ID,
          prjNo: dto.PRJ_NO,
          prjName: dto.PRJ_NAME,
          prjMain: dto.PRJ_MAIN,
          prjSub: dto.PRJ_SUB,
          proprietor: dto.PROPRIETOR,
          proprietorLevel: dto.PROPRIETOR_LEVEL ?? 3,
          startDate: dto.START_DATE,
          endDate: dto.END_DATE,
          budget: String(dto.BUDGET ?? 0),
          roadKm: String(dto.ROAD_KM ?? 0),
          state: 'DRAFT'
        })
      );

      // 沒有這一步的話，建立者自己也看不到剛建好的標案
      await manager
        .getRepository(CompanyProject)
        .save(
          manager
            .getRepository(CompanyProject)
            .create({ company: { id: companyId }, project: { id: project.id }, role: 'MAIN', isActive: true })
        );

      return project;
    });

    // 標案內容改變時明確清除：使用者剛改完會立刻回列表確認，
    // 這是他們會注意到的落差；案件統計的落差則由 TTL 收斂
    await this.redisService.delByPrefix(PROJECT_CACHE_PREFIX);

    return HttpResponse.success({ message: '標案已建立', data: { ID: saved.id, PRJ_ID: saved.prjId } });
  }

  /** 變更標案狀態 */
  public async updateState(dto: UpdateProjectStateDto): Promise<HttpResult> {
    const result = await this.projectRepo.update({ id: dto.ID }, { state: dto.STATE as ProjectState });
    if (!result.affected) throw new NotFoundException(`找不到標案：${dto.ID}`);

    // 標案內容改變時明確清除：使用者剛改完會立刻回列表確認，
    // 這是他們會注意到的落差；案件統計的落差則由 TTL 收斂
    await this.redisService.delByPrefix(PROJECT_CACHE_PREFIX);

    return HttpResponse.success({ message: '標案狀態已更新' });
  }

  /**
   * 維護標案關聯（公司／車輛／工務段轄區）。
   *
   * 停用而非刪除：換廠商、車輛調度、轄區調整都是常態，
   * 但去年的案件仍然要查得到當時是誰在做、哪台車跑的。
   */
  public async upsertRelation(dto: UpsertProjectRelationDto): Promise<HttpResult> {
    const project = await this.projectRepo.findOne({ where: { id: dto.PROJECT_ID } });
    if (!project) throw new NotFoundException(`找不到標案：${dto.PROJECT_ID}`);

    if (dto.KIND === 'COMPANY') {
      const existing = await this.companyProjectRepo.findOne({
        where: { project: { id: dto.PROJECT_ID }, company: { id: dto.TARGET_ID } }
      });

      if (existing)
        await this.companyProjectRepo.update(
          { id: existing.id },
          { isActive: dto.IS_ACTIVE ?? true, role: dto.ROLE ?? existing.role }
        );
      else
        await this.companyProjectRepo.save(
          this.companyProjectRepo.create({
            project: { id: dto.PROJECT_ID },
            company: { id: dto.TARGET_ID },
            role: dto.ROLE ?? 'SUB',
            isActive: dto.IS_ACTIVE ?? true
          })
        );
    }

    if (dto.KIND === 'VEHICLE') {
      const existing = await this.projectVehicleRepo.findOne({
        where: { project: { id: dto.PROJECT_ID }, vehicle: { id: dto.TARGET_ID } }
      });

      if (existing) await this.projectVehicleRepo.update({ id: existing.id }, { isActive: dto.IS_ACTIVE ?? true });
      else
        await this.projectVehicleRepo.save(
          this.projectVehicleRepo.create({
            project: { id: dto.PROJECT_ID },
            vehicle: { id: dto.TARGET_ID },
            isActive: dto.IS_ACTIVE ?? true
          })
        );
    }

    if (dto.KIND === 'SECTION') {
      const existing = await this.projectSectionRepo.findOne({
        where: { project: { id: dto.PROJECT_ID }, section: { id: dto.TARGET_ID } }
      });

      const ps =
        existing ??
        (await this.projectSectionRepo.save(
          this.projectSectionRepo.create({
            project: { id: dto.PROJECT_ID },
            section: { id: dto.TARGET_ID },
            isActive: true
          })
        ));

      if (existing) await this.projectSectionRepo.update({ id: existing.id }, { isActive: dto.IS_ACTIVE ?? true });

      // 轄區掛在「標案-工務段」之下：同一個工務段在不同標案負責的行政區可以不同
      for (const areaId of dto.AREA_IDS ?? []) {
        const sa = await this.sectionAreaRepo.findOne({
          where: { projectSection: { id: ps.id }, area: { id: areaId } }
        });

        if (sa) await this.sectionAreaRepo.update({ id: sa.id }, { isActive: true });
        else
          await this.sectionAreaRepo.save(
            this.sectionAreaRepo.create({ projectSection: { id: ps.id }, area: { id: areaId }, isActive: true })
          );
      }
    }

    // 標案內容改變時明確清除：使用者剛改完會立刻回列表確認，
    // 這是他們會注意到的落差；案件統計的落差則由 TTL 收斂
    await this.redisService.delByPrefix(PROJECT_CACHE_PREFIX);

    return HttpResponse.success({ message: '關聯已更新' });
  }

  /** 工務段清單 */
  public async listSections(companyId: number): Promise<HttpResult> {
    const rows = await this.sectionRepo.find({ where: { company: { id: companyId } }, order: { key: 'ASC' } });

    return HttpResponse.successOrWarn({ data: rows.map((s) => ({ ID: s.id, KEY: s.key, NAME: s.name })) });
  }

  /** 行政區清單：查詢條件的下拉選單用 */
  public async listAreas(county?: string): Promise<HttpResult> {
    const qb = this.areaRepo.createQueryBuilder('a').orderBy('a.county', 'ASC').addOrderBy('a.district', 'ASC');
    if (county) qb.where('a.county = :county', { county });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((a) => ({ ID: a.id, COUNTY: a.county, DISTRICT: a.district }))
    });
  }
}
