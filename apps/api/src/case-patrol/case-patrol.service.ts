import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { PatrolCase, type CaseSource } from './entities/patrol-case.entity';
import { PatrolCaseAddress } from './entities/patrol-case-address.entity';
import { PatrolCaseStatus } from './entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { ProjectVehicle } from '@/project/entities/project-vehicle.entity';
import { GeoService } from '@/geo/geo.service';
import { CaseIngestProducer } from '@/queue/case-ingest.producer';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { CRACK_TYPE_DEF } from '@road-patrol/shared';
import type { AuthUser } from '@app-types/user-auth.type';
import {
  AddCaseDto,
  BatchUpdateStatusDto,
  CaseQueryDto,
  CaseStatsQueryDto,
  NearbyQueryDto,
  UpdateCaseDto,
  UpdateCaseStatusDto
} from './case-patrol.dto';

/** 重複判定的門檻：30 公尺內、前後 30 天、同一種破壞 */
const DUPLICATE_RADIUS_M = 30;
const DUPLICATE_WINDOW_DAYS = 30;

@Injectable()
export class CasePatrolService {
  private readonly logger = new Logger('CasePatrol');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseAddress) private readonly addressRepo: Repository<PatrolCaseAddress>,
    @InjectRepository(PatrolCaseStatus) private readonly statusRepo: Repository<PatrolCaseStatus>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectVehicle) private readonly projectVehicleRepo: Repository<ProjectVehicle>,
    private readonly geoService: GeoService,
    private readonly caseIngestProducer: CaseIngestProducer,
    private readonly storageService: StorageService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 新增案件。
   *
   * 冪等第三道：external_id 唯一鍵 + ON CONFLICT DO NOTHING。
   * 另外還有 (dt_record, img_detect, crack_id) 的唯一鍵 ——
   * 車機在重送時 external_id 會一致，但若上游改用新的識別碼重送，
   * 這組值仍然擋得住同一個破壞被記兩次。
   *
   * 主表、地址、狀態三張表在同一個交易裡建立：
   * 只有主表而沒有狀態的案件，在二篩畫面上會神祕地消失。
   */
  public async addCase(dto: AddCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const before = await this.caseRepo.findOne({ where: { externalId: dto.EXTERNAL_ID }, select: { id: true } });

    if (before) {
      this.logger.warn(`重複案件，已略過寫入: ${dto.EXTERNAL_ID}`);
      return HttpResponse.success({ message: '案件已存在(重複遞送)', data: { ID: before.id, DUPLICATED: true } });
    }

    // 標案與車輛：車機只帶代碼與車號，要換成關聯
    const project = await this.projectRepo.findOne({ where: { prjId: dto.PRJ_ID } });
    const projectVehicle = project
      ? await this.projectVehicleRepo.findOne({
          where: { project: { id: project.id }, vehicle: { plateNo: dto.CAR }, isActive: true },
          relations: { vehicle: true }
        })
      : null;

    const saved = await this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(PatrolCase);

      await caseRepo
        .createQueryBuilder()
        .insert()
        .into(PatrolCase)
        .values({
          company: { id: user.companyId },
          project: project ? { id: project.id } : undefined,
          reporter: { id: user.uid },
          externalId: dto.EXTERNAL_ID,
          source: (dto.SOURCE ?? 'VEHICLE') as CaseSource,
          dtRecord: dto.DT_RECORD,
          car: dto.CAR,
          vehicle: projectVehicle?.vehicle ? { id: projectVehicle.vehicle.id } : undefined,
          crackType: dto.CRACK_TYPE,
          degree: dto.DEGREE,
          crackId: dto.CRACK_ID ?? 0,
          length: dto.LENGTH,
          width: dto.WIDTH,
          area: dto.AREA,
          depth: dto.DEPTH,
          img: dto.IMG,
          imgDetect: dto.IMG_DETECT,
          imgMapArea: dto.IMG_MAP_AREA,
          longitude: dto.LNG,
          latitude: dto.LAT,
          altitude: dto.ALTITUDE,
          geom: { type: 'Point', coordinates: [dto.LNG, dto.LAT] },
          serialNo: dto.SERIAL_NO,
          path: dto.PATH,
          remark: dto.REMARK
        })
        .orIgnore()
        .execute();

      const row = await caseRepo.findOneOrFail({ where: { externalId: dto.EXTERNAL_ID } });

      // 狀態與地址同時建立：缺了狀態的案件在二篩畫面上會神祕地消失
      await manager.getRepository(PatrolCaseStatus).save(
        manager.getRepository(PatrolCaseStatus).create({ patrolCase: { id: row.id }, status: 0, edited: 0, needRepair: 0 })
      );
      await manager.getRepository(PatrolCaseAddress).save(manager.getRepository(PatrolCaseAddress).create({ patrolCase: { id: row.id } }));

      return row;
    });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: this.toSnapshot(saved),
      operatorId: user.uid,
      source: 'DEVICE',
      clientIp
    });

    // 慢的活丟給 worker：逆地理編碼、案件編碼，都不該卡住車機的回應
    await this.caseIngestProducer.dispatch(
      { caseId: saved.id, externalId: saved.externalId, companyId: user.companyId, lng: dto.LNG, lat: dto.LAT, photoKey: saved.img },
      { crackType: saved.crackType, detectedAt: saved.dtRecord.toISOString() }
    );

    return HttpResponse.success({ message: '案件已建立', data: { ID: saved.id, DUPLICATED: false } });
  }

  /** 查詢案件（完整條件） */
  public async getCases(dto: CaseQueryDto, companyId: number): Promise<HttpResult> {
    const page = dto.PAGE ?? 1;
    const size = dto.SIZE ?? 50;

    const qb = this.buildQuery(dto, companyId)
      .leftJoinAndSelect('c.reporter', 'u')
      .leftJoinAndSelect('c.vehicle', 'v')
      .skip((page - 1) * size)
      .take(size);

    // 排序欄位用白名單映射到實體屬性：把使用者輸入拼進 orderBy 就是 SQL injection
    const SORT: Record<string, string> = {
      DT_RECORD: 'c.dtRecord',
      AREA: 'c.area',
      DEGREE: 'c.degree',
      STATUS: 'st.status',
      CASE_NUM: 'c.caseNum'
    };
    qb.orderBy(SORT[dto.SORT_BY ?? 'DT_RECORD'], (dto.SORT_DIR ?? 'DESC') as 'ASC' | 'DESC');

    const [rows, total] = await qb.getManyAndCount();

    return HttpResponse.successOrWarn({
      data: { TOTAL: total, PAGE: page, SIZE: size, ROWS: await this.withImageUrls(rows.map((c) => this.toRow(c))) },
      isEmpty: (v) => !v?.ROWS?.length
    });
  }

  /** 單筆詳情 */
  public async getCaseById(id: number, companyId: number): Promise<HttpResult> {
    const row = await this.caseRepo.findOne({
      where: { id, company: { id: companyId } },
      // 巢狀關聯要明寫：只寫 status: true 的話，狀態列會載入但「誰改的」是空的 ——
      // 而那正是詳情頁最想知道的欄位
      relations: {
        address: true,
        status: { updStatusUsr: true, updStatusAdm: true, updEditedUsr: true, updNeedRepairUsr: true },
        reporter: true,
        vehicle: true,
        project: true
      }
    });
    if (!row) throw new NotFoundException(`找不到案件：${id}`);

    return HttpResponse.success({ data: (await this.withImageUrls([this.toRow(row, true)]))[0] });
  }

  /**
   * 可能重複回報的案件。
   *
   * 同一個坑洞常被不同班次、不同來源重複拍到 —— 車機今天拍一次、
   * 民眾用 APP 又報一次。它們的 `external_id` 不同，去重機制擋不掉，
   * 但派工時應該併成一張單，否則會派兩班人去修同一個坑。
   *
   * 判定條件是「同類型 + 半徑內 + 時間相近 + 還沒完修」——
   * 只比座標的話，同一個路口不同時期的破壞會被誤判成同一件。
   */
  public async getDuplicates(id: number, companyId: number): Promise<HttpResult> {
    const target = await this.caseRepo.findOne({ where: { id, company: { id: companyId } } });
    if (!target) throw new NotFoundException(`找不到案件：${id}`);

    const rows = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.address', 'ad')
      .leftJoinAndSelect('c.status', 'st')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('c.id != :id', { id })
      .andWhere('c.crack_type = :crackType', { crackType: target.crackType })
      // 半徑用 geography：單位就是公尺，而且吃得到 GiST 索引
      .andWhere('ST_DWithin(c.geom, :origin::geography, :radius)', {
        origin: `SRID=4326;POINT(${target.longitude} ${target.latitude})`,
        radius: DUPLICATE_RADIUS_M
      })
      .andWhere('c.dt_record BETWEEN :from AND :to', {
        from: new Date(target.dtRecord.getTime() - DUPLICATE_WINDOW_DAYS * 86400000),
        to: new Date(target.dtRecord.getTime() + DUPLICATE_WINDOW_DAYS * 86400000)
      })
      // 已完修的不算重複：那個坑已經處理掉了
      .andWhere('COALESCE(st.need_repair, 0) != -1')
      .orderBy('c.dt_record', 'DESC')
      .limit(20)
      .getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((c) => ({
        ID: c.id,
        CASE_NUM: c.caseNum ?? c.externalId,
        CRACK_TYPE: c.crackType,
        DEGREE: c.degree,
        DT_RECORD: c.dtRecord,
        ROAD: c.address?.road ?? null,
        ADDRESS: c.address?.address ?? null,
        NEED_REPAIR: c.status?.needRepair ?? 0,
        // 距離直接算好回去：前端要顯示「30 公尺外」，自己用座標算會有投影誤差
        DISTANCE_M: Math.round(
          this.haversine(target.longitude, target.latitude, c.longitude, c.latitude)
        )
      })),
      warnMsg: '沒有可能重複的案件'
    });
  }

  /** 兩點距離(公尺)；只用在顯示，不用在篩選 —— 篩選交給 PostGIS */
  private haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** 更新案件欄位 */
  public async updateCase(dto: UpdateCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.caseRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { address: true, status: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到案件：${dto.ID}`);

    const before = this.toSnapshot(current);

    const patch: Record<string, unknown> = {};
    if (dto.CRACK_TYPE) patch.crackType = dto.CRACK_TYPE;
    if (dto.DEGREE) patch.degree = dto.DEGREE;
    if (dto.LENGTH !== undefined) patch.length = dto.LENGTH;
    if (dto.WIDTH !== undefined) patch.width = dto.WIDTH;
    if (dto.AREA !== undefined) patch.area = dto.AREA;
    if (dto.DEPTH !== undefined) patch.depth = dto.DEPTH;
    if (dto.PROJECT_ID !== undefined) patch.project = { id: dto.PROJECT_ID };
    if (dto.REMARK !== undefined) patch.remark = dto.REMARK;

    const addrPatch: Record<string, unknown> = {};
    if (dto.COUNTY !== undefined) addrPatch.county = dto.COUNTY;
    if (dto.DISTRICT !== undefined) addrPatch.district = dto.DISTRICT;
    if (dto.CAVLGE !== undefined) addrPatch.cavlge = dto.CAVLGE;
    if (dto.ROAD !== undefined) addrPatch.road = dto.ROAD;
    if (dto.ADDRESS !== undefined) addrPatch.address = dto.ADDRESS;

    if (!Object.keys(patch).length && !Object.keys(addrPatch).length) throw new BadRequestException('沒有要更新的欄位');

    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(patch).length) await manager.getRepository(PatrolCase).update({ id: dto.ID }, patch);

      if (Object.keys(addrPatch).length) {
        const addrRepo = manager.getRepository(PatrolCaseAddress);
        const existing = await addrRepo.findOne({ where: { patrolCase: { id: dto.ID } } });

        if (existing) await addrRepo.update({ id: existing.id }, addrPatch);
        else await addrRepo.save(addrRepo.create({ patrolCase: { id: dto.ID }, ...addrPatch }));
      }

      // 人工改過就標記 edited：稽核要看的是「有沒有被人動過」
      const statusRepo = manager.getRepository(PatrolCaseStatus);
      const status = await statusRepo.findOne({ where: { patrolCase: { id: dto.ID } } });
      if (status) {
        await statusRepo.update({ id: status.id }, { edited: 1, updEditedUsr: { id: user.uid } as never, updEditedAt: new Date() });
      }
    });

    const after = await this.caseRepo.findOne({ where: { id: dto.ID }, relations: { address: true, status: true, project: true } });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: dto.ID,
      action: 'UPDATED',
      snapshot: after ? this.toSnapshot(after) : {},
      before,
      operatorId: user.uid,
      note: dto.REMARK,
      clientIp
    });

    return HttpResponse.success({ message: '案件已更新' });
  }

  /**
   * 更新狀態。
   *
   * 三組狀態分開更新，各自記錄「誰改的、什麼時候」。
   * 管理者覆核另外記一組 —— 覆核紀錄不該被使用者的後續操作蓋掉。
   */
  public async updateStatus(dto: UpdateCaseStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.caseRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, address: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到案件：${dto.ID}`);
    if (dto.STATUS === undefined && dto.NEED_REPAIR === undefined) throw new BadRequestException('沒有要更新的狀態');

    const before = this.toSnapshot(current);
    const now = new Date();

    const patch: Record<string, unknown> = {};

    if (dto.STATUS !== undefined) {
      patch.status = dto.STATUS;

      if (dto.AS_ADMIN) {
        patch.updStatusAdm = { id: user.uid };
        patch.updStatusAdmAt = now;
      } else {
        patch.updStatusUsr = { id: user.uid };
        patch.updStatusUsrAt = now;
      }
    }

    if (dto.NEED_REPAIR !== undefined) {
      patch.needRepair = dto.NEED_REPAIR;
      patch.updNeedRepairUsr = { id: user.uid };
      patch.updNeedRepairAt = now;
    }

    const statusRepo = this.statusRepo;
    const existing = current.status ?? (await statusRepo.findOne({ where: { patrolCase: { id: dto.ID } } }));

    if (existing) await statusRepo.update({ id: existing.id }, patch as never);
    else await statusRepo.save(statusRepo.create({ patrolCase: { id: dto.ID }, ...patch } as never));

    const after = await this.caseRepo.findOne({ where: { id: dto.ID }, relations: { status: true, address: true, project: true } });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: dto.ID,
      action: 'STATUS_CHANGED',
      snapshot: after ? this.toSnapshot(after) : {},
      before,
      fromState: String(current.status?.status ?? 0),
      toState: String(dto.STATUS ?? current.status?.status ?? 0),
      operatorId: user.uid,
      note: dto.REMARK,
      clientIp
    });

    return HttpResponse.success({ message: '狀態已更新' });
  }

  /**
   * 批次更新狀態。
   *
   * 二篩是一批一批做的 —— 一次看幾十張圖，全部通過。
   * 一筆一筆送的話，五十筆就是五十次往返，而且中途失敗會留下一半改一半沒改。
   */
  public async batchUpdateStatus(dto: BatchUpdateStatusDto, user: AuthUser): Promise<HttpResult> {
    if (!dto.IDS.length) throw new BadRequestException('沒有指定案件');
    if (dto.STATUS === undefined && dto.NEED_REPAIR === undefined) throw new BadRequestException('沒有要更新的狀態');

    const cases = await this.caseRepo.find({
      where: dto.IDS.map((id) => ({ id, company: { id: user.companyId } })),
      relations: { status: true, address: true, project: true }
    });

    const now = new Date();
    let updated = 0;

    for (const c of cases) {
      const before = this.toSnapshot(c);
      const patch: Record<string, unknown> = {};

      if (dto.STATUS !== undefined) {
        patch.status = dto.STATUS;
        if (dto.AS_ADMIN) {
          patch.updStatusAdm = { id: user.uid };
          patch.updStatusAdmAt = now;
        } else {
          patch.updStatusUsr = { id: user.uid };
          patch.updStatusUsrAt = now;
        }
      }

      if (dto.NEED_REPAIR !== undefined) {
        patch.needRepair = dto.NEED_REPAIR;
        patch.updNeedRepairUsr = { id: user.uid };
        patch.updNeedRepairAt = now;
      }

      if (c.status) await this.statusRepo.update({ id: c.status.id }, patch as never);
      else await this.statusRepo.save(this.statusRepo.create({ patrolCase: { id: c.id }, ...patch } as never));

      await this.caseHistoryService.record({
        caseType: 'CASE_PATROL',
        caseId: c.id,
        action: 'STATUS_CHANGED',
        snapshot: { ...before, status: dto.STATUS ?? before.status, needRepair: dto.NEED_REPAIR ?? before.needRepair },
        before,
        operatorId: user.uid,
        note: '批次更新'
      });

      updated += 1;
    }

    return HttpResponse.success({ message: `已更新 ${updated} 筆`, data: { UPDATED: updated } });
  }

  /** 查詢附近案件 */
  public async getNearby(dto: NearbyQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.geoService.findNearby(dto.LNG, dto.LAT, dto.RADIUS_M ?? 500, companyId);
    return HttpResponse.successOrWarn({ data: rows, warnMsg: '半徑內查無案件' });
  }

  /** 多維度統計 */
  public async getStats(dto: CaseStatsQueryDto, companyId: number): Promise<HttpResult> {
    const GROUP_EXPR: Record<string, string> = {
      DAY: "to_char(date_trunc('day', c.dt_record), 'YYYY-MM-DD')",
      WEEK: `to_char(date_trunc('week', c.dt_record), 'YYYY-"W"IW')`,
      MONTH: "to_char(date_trunc('month', c.dt_record), 'YYYY-MM')",
      DISTRICT: "COALESCE(addr.district, '未分區')",
      CAVLGE: "COALESCE(addr.cavlge, '未分里')",
      ROAD: "COALESCE(addr.road, '未定位')",
      CRACK_TYPE: 'c.crack_type',
      DEGREE: 'c.degree',
      CAR: "COALESCE(c.car, '未知')",
      PRJ_ID: "COALESCE(p.prj_id, '未歸屬')"
    };

    const expr = GROUP_EXPR[dto.GROUP_BY ?? 'DAY'];

    const qb = this.buildQuery(dto as CaseQueryDto, companyId)
      .select(expr, 'GROUP_KEY')
      .addSelect('COUNT(*)::int', 'TOTAL')
      .addSelect('COUNT(*) FILTER (WHERE st.status = 1)::int', 'PASSED')
      .addSelect('COUNT(*) FILTER (WHERE st.need_repair = 2)::int', 'DISPATCHED')
      .addSelect('ROUND(SUM(c.area)::numeric, 2)::float8', 'AREA')
      .groupBy(expr)
      .limit(200);

    // 時間維度照時間排序，其餘照數量 —— 折線圖的 x 軸不能亂序
    if (['DAY', 'WEEK', 'MONTH'].includes(dto.GROUP_BY ?? 'DAY')) qb.orderBy('"GROUP_KEY"', 'ASC');
    else qb.orderBy('"TOTAL"', 'DESC');

    return HttpResponse.successOrWarn({ data: await qb.getRawMany() });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /** 查詢條件組裝；查詢、統計、報表共用同一份 */
  private buildQuery(dto: CaseQueryDto, companyId: number) {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.address', 'addr')
      .leftJoinAndSelect('c.status', 'st')
      .leftJoinAndSelect('c.project', 'p')
      .where('c.company_id = :companyId', { companyId });

    if (dto.START_DATE) qb.andWhere('c.dt_record >= :start', { start: new Date(dto.START_DATE) });
    if (dto.END_DATE) qb.andWhere('c.dt_record < :end', { end: new Date(`${dto.END_DATE}T23:59:59.999`) });

    if (dto.CASE_NUM) qb.andWhere('c.case_num ILIKE :caseNum', { caseNum: `${dto.CASE_NUM}%` });
    if (dto.EXTERNAL_ID) qb.andWhere('c.external_id ILIKE :extId', { extId: `%${dto.EXTERNAL_ID}%` });

    if (dto.CRACK_TYPE?.length) qb.andWhere('c.crack_type IN (:...crackType)', { crackType: dto.CRACK_TYPE });
    if (dto.DEGREE?.length) qb.andWhere('c.degree IN (:...degree)', { degree: dto.DEGREE });
    if (dto.AREA_MIN !== undefined) qb.andWhere('c.area >= :areaMin', { areaMin: dto.AREA_MIN });
    if (dto.AREA_MAX !== undefined) qb.andWhere('c.area <= :areaMax', { areaMax: dto.AREA_MAX });
    if (dto.DEPTH_MIN !== undefined) qb.andWhere('c.depth >= :depthMin', { depthMin: dto.DEPTH_MIN });

    if (dto.COUNTY) qb.andWhere('addr.county = :county', { county: dto.COUNTY });
    if (dto.DISTRICT?.length) qb.andWhere('addr.district IN (:...district)', { district: dto.DISTRICT });

    // 工務段沒有寫在案件上：轄區是「標案-工務段」關聯出來的行政區清單。
    // 用子查詢而不是把 sections 一路 join 進主查詢 ——
    // 那會讓一個案件對到多列轄區，分頁的總筆數就跟著錯
    if (dto.SECTION_ID?.length) {
      qb.andWhere(
        `addr.district IN (
           SELECT a.district
             FROM project_sections ps
             JOIN section_areas sa ON sa.project_section_id = ps.id AND sa.is_active = true
             JOIN areas a ON a.id = sa.area_id
            WHERE ps.section_id IN (:...sectionIds) AND ps.is_active = true
         )`,
        { sectionIds: dto.SECTION_ID }
      );
    }
    if (dto.CAVLGE) qb.andWhere('addr.cavlge = :cavlge', { cavlge: dto.CAVLGE });
    if (dto.ROAD) qb.andWhere('addr.road ILIKE :road', { road: `%${dto.ROAD}%` });
    if (dto.ADDRESS) qb.andWhere('addr.address ILIKE :addrText', { addrText: `%${dto.ADDRESS}%` });

    if (dto.STATUS?.length) qb.andWhere('st.status IN (:...status)', { status: dto.STATUS });
    if (dto.EDITED?.length) qb.andWhere('st.edited IN (:...edited)', { edited: dto.EDITED });
    if (dto.NEED_REPAIR?.length) qb.andWhere('st.need_repair IN (:...needRepair)', { needRepair: dto.NEED_REPAIR });

    if (dto.PRJ_ID?.length) qb.andWhere('p.prj_id IN (:...prjId)', { prjId: dto.PRJ_ID });
    if (dto.CAR) qb.andWhere('c.car ILIKE :car', { car: `%${dto.CAR}%` });
    if (dto.SOURCE?.length) qb.andWhere('c.source IN (:...source)', { source: dto.SOURCE });

    // 「還沒派工」用 NOT EXISTS 而不是 LEFT JOIN IS NULL：後者在分頁時會讓計數失準
    if (dto.UNDISPATCHED) qb.andWhere('NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.case_patrol_id = c.id)');
    if (dto.HAS_IMAGE) qb.andWhere('c.img IS NOT NULL');

    if (dto.KEYWORD) {
      qb.andWhere('(addr.road ILIKE :kw OR addr.address ILIKE :kw OR c.remark ILIKE :kw OR c.case_num ILIKE :kw OR c.external_id ILIKE :kw)', {
        kw: `%${dto.KEYWORD}%`
      });
    }

    return qb;
  }

  /** 歷程快照：只記會被追究的欄位，不是整個實體 */
  private toSnapshot(c: PatrolCase): Record<string, unknown> {
    return {
      caseNum: c.caseNum ?? null,
      crackType: c.crackType,
      degree: c.degree,
      length: c.length,
      width: c.width,
      area: c.area,
      depth: c.depth ?? null,
      longitude: c.longitude,
      latitude: c.latitude,
      img: c.img ?? null,
      imgDetect: c.imgDetect ?? null,
      projectId: c.project?.id ?? null,
      county: c.address?.county ?? null,
      district: c.address?.district ?? null,
      cavlge: c.address?.cavlge ?? null,
      road: c.address?.road ?? null,
      address: c.address?.address ?? null,
      status: c.status?.status ?? 0,
      edited: c.status?.edited ?? 0,
      needRepair: c.status?.needRepair ?? 0,
      remark: c.remark ?? null
    };
  }

  /**
   * 補上可直接顯示的圖片網址。
   *
   * 資料庫存的是物件 key，不是網址 —— bucket 不開公開讀取，
   * 所以每次都要現簽一組短效網址。簽名是本機 HMAC 運算，不會連出去，
   * 一頁五十筆一起簽也只是微秒等級。
   *
   * 網址每次重新簽發，前端不要存起來重複使用。
   */
  private async withImageUrls<T extends { IMG?: string | null; IMG_DETECT?: string | null }>(rows: T[]): Promise<T[]> {
    return await Promise.all(
      rows.map(async (r) => ({
        ...r,
        IMG_URL: r.IMG ? await this.storageService.signGetUrl(r.IMG, 600) : null,
        IMG_DETECT_URL: r.IMG_DETECT ? await this.storageService.signGetUrl(r.IMG_DETECT, 600) : null
      }))
    );
  }

  /** entity → 對外欄位 */
  private toRow(c: PatrolCase, detail = false) {
    const crack = CRACK_TYPE_DEF.find((t) => t.key === c.crackType);

    const base = {
      ID: c.id,
      CASE_NUM: c.caseNum ?? null,
      EXTERNAL_ID: c.externalId,
      SOURCE: c.source,
      DT_RECORD: c.dtRecord,
      PRJ_ID: c.project?.prjId ?? null,
      PROJECT_ID: c.project?.id ?? null,
      PROJECT_NAME: c.project?.prjName ?? null,
      CAR: c.car ?? null,
      VEHICLE_ID: c.vehicle?.id ?? null,
      CRACK_TYPE: c.crackType,
      CRACK_TYPE_NAME: crack?.name ?? c.crackType,
      DEGREE: c.degree,
      CRACK_ID: c.crackId,
      LENGTH: c.length,
      WIDTH: c.width,
      AREA: c.area,
      DEPTH: c.depth ?? null,
      IMG: c.img ?? null,
      IMG_DETECT: c.imgDetect ?? null,
      IMG_MAP_AREA: c.imgMapArea ?? null,
      LNG: c.longitude,
      LAT: c.latitude,
      ALTITUDE: c.altitude ?? null,
      SERIAL_NO: c.serialNo ?? null,
      COUNTY: c.address?.county ?? null,
      DISTRICT: c.address?.district ?? null,
      CAVLGE: c.address?.cavlge ?? null,
      NEIGHBOR: c.address?.neighbor ?? null,
      ROAD: c.address?.road ?? null,
      HOUSE_NUMBER: c.address?.houseNumber ?? null,
      ADDRESS: c.address?.address ?? null,
      STATUS: c.status?.status ?? 0,
      EDITED: c.status?.edited ?? 0,
      NEED_REPAIR: c.status?.needRepair ?? 0,
      REMARK: c.remark ?? null,
      REPORTER: c.reporter?.name ?? null,
      CREATED_AT: c.createdAt
    };

    if (!detail) return base;

    // 詳情才回傳「誰在什麼時候改的」：清單頁不需要，多查會拖慢分頁
    return {
      ...base,
      PATH: c.path ?? null,
      O_ADDRESS: c.address?.oAddress ?? null,
      UPD_STATUS_USR: c.status?.updStatusUsr?.name ?? null,
      UPD_STATUS_USR_AT: c.status?.updStatusUsrAt ?? null,
      UPD_STATUS_ADM: c.status?.updStatusAdm?.name ?? null,
      UPD_STATUS_ADM_AT: c.status?.updStatusAdmAt ?? null,
      UPD_EDITED_USR: c.status?.updEditedUsr?.name ?? null,
      UPD_EDITED_AT: c.status?.updEditedAt ?? null,
      UPD_NEED_REPAIR_USR: c.status?.updNeedRepairUsr?.name ?? null,
      UPD_NEED_REPAIR_AT: c.status?.updNeedRepairAt ?? null,
      UPDATED_AT: c.updatedAt
    };
  }
}
