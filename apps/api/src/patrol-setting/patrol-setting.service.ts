import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { PatrolPlan, type PatrolFrequency } from './entities/patrol-plan.entity';
import { CoverageQueryDto, PlanQueryDto, UpsertPlanDto } from './patrol-setting.dto';

@Injectable()
export class PatrolSettingService {
  private readonly logger = new Logger('PatrolSetting');

  constructor(@InjectRepository(PatrolPlan) private readonly planRepo: Repository<PatrolPlan>) {}

  /** 計畫清單 */
  public async list(dto: PlanQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.vehicle', 'v')
      .leftJoinAndSelect('p.project', 'prj')
      .where('p.company_id = :companyId', { companyId })
      .orderBy('p.code', 'ASC');

    if (dto.PROJECT_ID) qb.andWhere('p.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.FREQUENCY) qb.andWhere('p.frequency = :frequency', { frequency: dto.FREQUENCY });
    if (dto.ACTIVE !== undefined) qb.andWhere('p.active = :active', { active: dto.ACTIVE });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((p) => ({
        ID: p.id,
        CODE: p.code,
        NAME: p.name,
        FREQUENCY: p.frequency,
        VEHICLE: p.vehicle?.plateNo ?? null,
        VEHICLE_ID: p.vehicle?.id ?? null,
        PROJECT: p.project?.prjId ?? null,
        PROJECT_ID: p.project?.id ?? null,
        ROUTE_KM: Number(p.routeKm),
        BUFFER_M: p.bufferM,
        ACTIVE: p.active,
        REMARK: p.remark ?? null
      }))
    });
  }

  /** 巡查路線圖層 */
  public async getLayer(dto: PlanQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.planRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .addSelect('p.code', 'code')
      .addSelect('p.name', 'name')
      .addSelect('p.frequency', 'frequency')
      .addSelect('p.active', 'active')
      .addSelect('p.route_km', 'routeKm')
      .addSelect('ST_AsGeoJSON(p.route)::json', 'geometry')
      .where('p.company_id = :companyId', { companyId });

    if (dto.PROJECT_ID) qb.andWhere('p.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.ACTIVE !== undefined) qb.andWhere('p.active = :active', { active: dto.ACTIVE });

    const rows = await qb.getRawMany<{ geometry: unknown; [k: string]: unknown }>();

    return HttpResponse.successOrWarn({
      data: {
        type: 'FeatureCollection',
        features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties }))
      },
      isEmpty: (v) => !v?.features?.length
    });
  }

  /** 新增或更新計畫；路線長度由 PostGIS 算，不信前端傳來的數字 */
  public async upsert(dto: UpsertPlanDto, companyId: number): Promise<HttpResult> {
    const duplicate = await this.planRepo
      .createQueryBuilder('p')
      .where('p.company_id = :companyId', { companyId })
      .andWhere('p.code = :code', { code: dto.CODE })
      .andWhere(dto.ID ? 'p.id != :id' : '1=1', dto.ID ? { id: dto.ID } : {})
      .getOne();

    if (duplicate) throw new ConflictException(`計畫代號已存在：${dto.CODE}`);

    const route = { type: 'LineString' as const, coordinates: dto.ROUTE };

    const payload = {
      company: { id: companyId },
      code: dto.CODE,
      name: dto.NAME,
      frequency: dto.FREQUENCY as PatrolFrequency,
      vehicle: dto.VEHICLE_ID ? { id: dto.VEHICLE_ID } : undefined,
      project: dto.PROJECT_ID ? { id: dto.PROJECT_ID } : undefined,
      route,
      bufferM: dto.BUFFER_M ?? 30,
      active: dto.ACTIVE ?? true,
      remark: dto.REMARK
    };

    const id = dto.ID
      ? (await this.planRepo.update({ id: dto.ID, company: { id: companyId } }, payload)).affected
        ? dto.ID
        : (() => {
            throw new NotFoundException(`找不到計畫：${dto.ID}`);
          })()
      : (await this.planRepo.save(this.planRepo.create(payload))).id;

    // 長度交給資料庫算：前端算出來的公里數在不同投影下會差好幾個百分點
    await this.planRepo.query(
      `UPDATE patrol_plans SET route_km = ROUND((ST_Length(route) / 1000)::numeric, 2) WHERE id = $1`,
      [id]
    );

    return HttpResponse.success({ message: dto.ID ? '計畫已更新' : '計畫已建立', data: { ID: id } });
  }

  /**
   * 巡查覆蓋率。
   *
   * 這是履約檢核最常被問的數字：「這週該巡的路，有幾成真的巡到了」。
   *
   * 作法是把軌跡點對每條計畫路線做緩衝距離比對，算出被覆蓋的路線比例。
   * 用 ST_Buffer + ST_Intersection 而不是逐點比對 —— 前者在資料庫裡一次算完，
   * 後者要把幾萬個點撈回 Node 端。
   */
  public async getCoverage(dto: CoverageQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.planRepo.query(
      `
      WITH covered AS (
        SELECT p.id,
               p.code,
               p.name,
               p.frequency,
               p.route_km,
               v.plate_no,
               -- 軌跡點的緩衝聯集與路線的交集長度 ÷ 路線總長 = 覆蓋率
               COALESCE(
                 ST_Length(
                   ST_Intersection(
                     p.route::geometry,
                     ST_Buffer(ST_Collect(t.geom::geometry)::geography, p.buffer_m)::geometry
                   )::geography
                 ) / NULLIF(ST_Length(p.route), 0),
                 0
               ) AS ratio,
               COUNT(t.id) AS point_count
          FROM patrol_plans p
          LEFT JOIN vehicles v ON v.id = p.vehicle_id
          LEFT JOIN vehicle_tracks t
                 ON t.company_id = p.company_id
                AND (p.vehicle_id IS NULL OR t.vehicle_id = p.vehicle_id)
                AND t.recorded_at BETWEEN $2 AND $3
                AND ST_DWithin(t.geom, p.route, p.buffer_m)
         WHERE p.company_id = $1
           AND p.active = true
           AND ($4::int IS NULL OR p.project_id = $4)
         GROUP BY p.id, v.plate_no
      )
      SELECT id            AS "ID",
             code          AS "CODE",
             name          AS "NAME",
             frequency     AS "FREQUENCY",
             plate_no      AS "VEHICLE",
             route_km::float8 AS "ROUTE_KM",
             point_count::int AS "POINTS",
             LEAST(100, ROUND((ratio * 100)::numeric, 1))::float8 AS "COVERAGE"
        FROM covered
       ORDER BY "COVERAGE" ASC
      `,
      [companyId, new Date(dto.DATE_START), new Date(`${dto.DATE_END}T23:59:59.999`), dto.PROJECT_ID ?? null]
    );

    const avg = rows.length ? rows.reduce((sum: number, r: any) => sum + Number(r.COVERAGE), 0) / rows.length : 0;

    return HttpResponse.successOrWarn({
      data: {
        PLANS: rows,
        AVG_COVERAGE: Number(avg.toFixed(1)),
        // 未達 80% 的計畫要主動列出：這是履約會被扣款的部分
        UNDER_TARGET: rows.filter((r: any) => Number(r.COVERAGE) < 80).length
      },
      isEmpty: (v) => !v?.PLANS?.length,
      warnMsg: '沒有啟用中的巡查計畫'
    });
  }
}
