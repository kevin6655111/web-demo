import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RoadLine, type Jurisdiction } from './entities/road-line.entity';
import { RoadBlock, type RoadBlockType } from './entities/road-block.entity';
import { PatrolPoint } from './entities/patrol-point.entity';
import { PatrolPointStat } from './entities/patrol-point-stat.entity';
import {
  BatchActiveDto,
  BatchBlockUpdateDto,
  BatchJurisdictionDto,
  DrawRouteDto,
  PatrolPointQueryDto,
  PointCoverageQueryDto,
  RenameRoadLineDto,
  RoadBlockQueryDto,
  RoadLineQueryDto,
  UpsertPatrolPointDto
} from './road-setting.dto';

/** 圖層一次最多回傳幾個圖徵；再多瀏覽器也畫不動 */
const LAYER_LIMIT = 5000;

/**
 * 道路設定與巡查點。
 *
 * 三種圖徵各自回答一個問題：
 *   線段  這條路在哪裡、歸誰管、納不納入巡查
 *   區塊  這一段路有多大（計價與鋪面面積的單位）
 *   點位  契約指定「一定要看到」的位置
 *
 * 全部以 GeoJSON `FeatureCollection` 回傳 —— 圖台的每一種圖層走同一個格式，
 * 新增一種圖徵不必在前端多寫一種解析。
 */
@Injectable()
export class RoadSettingService {
  private readonly logger = new Logger('RoadSetting');

  constructor(
    @InjectRepository(RoadLine) private readonly lineRepo: Repository<RoadLine>,
    @InjectRepository(RoadBlock) private readonly blockRepo: Repository<RoadBlock>,
    @InjectRepository(PatrolPoint) private readonly pointRepo: Repository<PatrolPoint>,
    @InjectRepository(PatrolPointStat) private readonly statRepo: Repository<PatrolPointStat>,
    private readonly dataSource: DataSource
  ) {}

  // ═══ 道路線段 ═══════════════════════════════════════════════════

  /** 線段圖層 */
  public async listLines(dto: RoadLineQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .select('l.id', 'id')
      .addSelect('l.code', 'code')
      .addSelect('l.road_name', 'roadName')
      .addSelect('l.display_name', 'displayName')
      // 顯示名稱優先：圖資的原始名稱常常是空的
      .addSelect("COALESCE(NULLIF(l.display_name, ''), NULLIF(l.road_name, ''), '(無名路段)')", 'label')
      .addSelect('l.district', 'district')
      .addSelect('l.jurisdiction', 'jurisdiction')
      .addSelect('l.lane_count', 'laneCount')
      .addSelect('l.length_m::float8', 'lengthM')
      .addSelect('l.is_active', 'isActive')
      .addSelect('l.remark', 'remark')
      .addSelect('ST_AsGeoJSON(l.geom)::json', 'geometry')
      .where('l.company_id = :companyId', { companyId })
      .limit(LAYER_LIMIT);

    this.applyScope(qb, 'l', dto);

    if (dto.JURISDICTION?.length) qb.andWhere('l.jurisdiction IN (:...jur)', { jur: dto.JURISDICTION });
    if (dto.IS_ACTIVE !== undefined) qb.andWhere('l.is_active = :active', { active: dto.IS_ACTIVE });
    // 無名路段：原始名稱與人工命名都是空的那些
    if (dto.UNNAMED_ONLY) qb.andWhere("COALESCE(NULLIF(l.display_name, ''), NULLIF(l.road_name, '')) IS NULL");

    return HttpResponse.successOrWarn({
      data: this.toFeatureCollection(await qb.getRawMany()),
      isEmpty: (v) => !v?.features?.length,
      warnMsg: '這個範圍沒有道路線段'
    });
  }

  /**
   * 批次啟用/停用。
   *
   * 圖台上框選一片線段之後一次送 —— 一條一條點的話，
   * 「把這個里的巷弄全部排除」要按上百次。
   */
  public async setLinesActive(dto: BatchActiveDto, companyId: number): Promise<HttpResult> {
    if (!dto.IDS.length) throw new BadRequestException('未指定線段');

    const result = await this.lineRepo
      .createQueryBuilder()
      .update()
      .set({ isActive: dto.IS_ACTIVE, ...(dto.REMARK !== undefined ? { remark: dto.REMARK } : {}) })
      .where('company_id = :companyId', { companyId })
      .andWhere('id IN (:...ids)', { ids: dto.IDS })
      .execute();

    return HttpResponse.success({
      message: `已將 ${result.affected ?? 0} 條線段${dto.IS_ACTIVE ? '納入' : '排除於'}巡查範圍`,
      data: { UPDATED: result.affected ?? 0 }
    });
  }

  /** 批次設定管轄單位 */
  public async setLinesJurisdiction(dto: BatchJurisdictionDto, companyId: number): Promise<HttpResult> {
    if (!dto.IDS.length) throw new BadRequestException('未指定線段');

    const result = await this.lineRepo
      .createQueryBuilder()
      .update()
      .set({ jurisdiction: dto.JURISDICTION as Jurisdiction })
      .where('company_id = :companyId', { companyId })
      .andWhere('id IN (:...ids)', { ids: dto.IDS })
      .execute();

    return HttpResponse.success({
      message: `已設定 ${result.affected ?? 0} 條線段的管轄單位`,
      data: { UPDATED: result.affected ?? 0 }
    });
  }

  /**
   * 命名一條線段。
   *
   * 一次一條而不是批次：名字是看著地圖一條一條打的，
   * 批次命名只會讓十條路叫同一個名字。
   */
  public async renameLine(dto: RenameRoadLineDto, companyId: number): Promise<HttpResult> {
    const result = await this.lineRepo.update(
      { id: dto.ID, company: { id: companyId } },
      { displayName: dto.DISPLAY_NAME }
    );
    if (!result.affected) throw new NotFoundException(`找不到線段：${dto.ID}`);

    return HttpResponse.success({ message: `已命名為「${dto.DISPLAY_NAME}」`, data: { ID: dto.ID } });
  }

  // ═══ 道路區塊 ═══════════════════════════════════════════════════

  public async listBlocks(dto: RoadBlockQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.blockRepo
      .createQueryBuilder('b')
      .select('b.id', 'id')
      .addSelect('b.code', 'code')
      .addSelect('b.road_name', 'roadName')
      .addSelect('b.district', 'district')
      .addSelect('b.block_type', 'blockType')
      .addSelect('b.status', 'status')
      .addSelect('b.lane_count', 'laneCount')
      .addSelect('b.width_m::float8', 'widthM')
      .addSelect('b.length_m::float8', 'lengthM')
      .addSelect('b.area_m2::float8', 'areaM2')
      .addSelect('b.remark', 'remark')
      .addSelect('ST_AsGeoJSON(b.geom)::json', 'geometry')
      .where('b.company_id = :companyId', { companyId })
      .limit(LAYER_LIMIT);

    this.applyScope(qb, 'b', dto);

    if (dto.BLOCK_TYPE?.length) qb.andWhere('b.block_type IN (:...types)', { types: dto.BLOCK_TYPE });
    if (dto.STATUS?.length) qb.andWhere('b.status IN (:...status)', { status: dto.STATUS });

    return HttpResponse.successOrWarn({
      data: this.toFeatureCollection(await qb.getRawMany()),
      isEmpty: (v) => !v?.features?.length,
      warnMsg: '這個範圍沒有道路區塊'
    });
  }

  /** 批次更新區塊：狀態、類型、車道數與備註，只送要改的 */
  public async updateBlocks(dto: BatchBlockUpdateDto, companyId: number): Promise<HttpResult> {
    if (!dto.IDS.length) throw new BadRequestException('未指定區塊');

    const patch: Record<string, unknown> = {};
    if (dto.STATUS !== undefined) patch.status = dto.STATUS;
    if (dto.BLOCK_TYPE !== undefined) patch.blockType = dto.BLOCK_TYPE as RoadBlockType;
    if (dto.LANE_COUNT !== undefined) patch.laneCount = dto.LANE_COUNT;
    if (dto.REMARK !== undefined) patch.remark = dto.REMARK;

    if (!Object.keys(patch).length) throw new BadRequestException('沒有要更新的欄位');

    const result = await this.blockRepo
      .createQueryBuilder()
      .update()
      .set(patch)
      .where('company_id = :companyId', { companyId })
      .andWhere('id IN (:...ids)', { ids: dto.IDS })
      .execute();

    return HttpResponse.success({
      message: `已更新 ${result.affected ?? 0} 個區塊`,
      data: { UPDATED: result.affected ?? 0 }
    });
  }

  // ═══ 巡查點 ═════════════════════════════════════════════════════

  public async listPoints(dto: PatrolPointQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.pointRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .addSelect('p.code', 'code')
      .addSelect('p.name', 'name')
      .addSelect('p.district', 'district')
      .addSelect('p.road_name', 'roadName')
      .addSelect('p.radius_m', 'radiusM')
      .addSelect('p.is_active', 'isActive')
      .addSelect('p.remark', 'remark')
      .addSelect('ST_AsGeoJSON(p.geom)::json', 'geometry')
      .where('p.company_id = :companyId', { companyId })
      .orderBy('p.code', 'ASC')
      .limit(LAYER_LIMIT);

    this.applyScope(qb, 'p', dto, 'name');

    if (dto.PROJECT_ID) qb.andWhere('p.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.IS_ACTIVE !== undefined) qb.andWhere('p.is_active = :active', { active: dto.IS_ACTIVE });

    return HttpResponse.successOrWarn({
      data: this.toFeatureCollection(await qb.getRawMany()),
      isEmpty: (v) => !v?.features?.length,
      warnMsg: '這個範圍沒有巡查點'
    });
  }

  public async upsertPoint(dto: UpsertPatrolPointDto, companyId: number): Promise<HttpResult> {
    const duplicate = await this.pointRepo
      .createQueryBuilder('p')
      .where('p.company_id = :companyId', { companyId })
      .andWhere('p.code = :code', { code: dto.CODE })
      .andWhere(dto.ID ? 'p.id != :id' : '1=1', dto.ID ? { id: dto.ID } : {})
      .getOne();
    if (duplicate) throw new ConflictException(`巡查點代號已存在：${dto.CODE}`);

    const payload = {
      company: { id: companyId },
      project: dto.PROJECT_ID ? { id: dto.PROJECT_ID } : null,
      code: dto.CODE,
      name: dto.NAME,
      county: dto.COUNTY,
      district: dto.DISTRICT,
      roadName: dto.ROAD_NAME,
      radiusM: dto.RADIUS_M ?? 30,
      isActive: dto.IS_ACTIVE ?? true,
      geom: { type: 'Point' as const, coordinates: [dto.LNG, dto.LAT] as [number, number] },
      remark: dto.REMARK
    };

    if (dto.ID) {
      const result = await this.pointRepo.update({ id: dto.ID, company: { id: companyId } }, payload as never);
      if (!result.affected) throw new NotFoundException(`找不到巡查點：${dto.ID}`);

      return HttpResponse.success({ message: '巡查點已更新', data: { ID: dto.ID } });
    }

    const saved = await this.pointRepo.save(this.pointRepo.create(payload as never));
    return HttpResponse.success({ message: '巡查點已建立', data: { ID: (saved as unknown as PatrolPoint).id } });
  }

  // ═══ 覆蓋率 ═════════════════════════════════════════════════════

  /**
   * 計算某一天的巡查點覆蓋率並寫入統計表。
   *
   * 判定方式是**相鄰軌跡點連成線段再比對距離**，而不是逐點比對：
   * 車機每 5 秒一筆，時速 50 公里時兩點之間有 70 公尺 ——
   * 逐點比對會讓車子「跳過」半徑 30 公尺的巡查點，明明開過去了卻沒算到。
   *
   * 連成線段之後用 `ST_DWithin` 一次算完，吃得到 GiST 索引。
   *
   * 寫入是覆寫（`ON CONFLICT DO UPDATE`）：中途補跑不會讓數字翻倍。
   */
  public async computeCoverage(companyId: number, date: string): Promise<{ rows: number; covered: number }> {
    const rows = await this.dataSource.query(
      `
      WITH day_track AS (
        -- 一台車一天的軌跡連成一條線；跨車不能連，否則兩台車之間會多出一條假線段
        SELECT t.vehicle_id,
               t.project_id,
               ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at) AS path,
               COUNT(*)::int AS points
          FROM vehicle_tracks t
         WHERE t.company_id = $1
           AND t.recorded_at >= $2::date
           AND t.recorded_at <  $2::date + interval '1 day'
         GROUP BY t.vehicle_id, t.project_id
        HAVING COUNT(*) >= 2
      ),
      covered AS (
        SELECT p.id,
               p.project_id,
               p.county,
               p.district,
               EXISTS (
                 SELECT 1 FROM day_track d
                  WHERE ST_DWithin(d.path::geography, p.geom, p.radius_m)
               ) AS is_covered
          FROM patrol_points p
         WHERE p.company_id = $1 AND p.is_active = true
      ),
      track_count AS (
        SELECT COALESCE(SUM(points), 0)::int AS points FROM day_track
      )
      INSERT INTO patrol_point_stats
             (company_id, stat_date, project_id, county, district, required_points, covered_points, coverage_rate, track_points, updated_at)
      SELECT $1,
             $2::date,
             c.project_id,
             MIN(c.county),
             c.district,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE c.is_covered)::int,
             ROUND(COUNT(*) FILTER (WHERE c.is_covered)::numeric * 100 / NULLIF(COUNT(*), 0), 2),
             (SELECT points FROM track_count),
             now()
        FROM covered c
       GROUP BY c.project_id, c.district
      ON CONFLICT (company_id, stat_date, project_id, district)
      DO UPDATE SET required_points = EXCLUDED.required_points,
                    covered_points  = EXCLUDED.covered_points,
                    coverage_rate   = EXCLUDED.coverage_rate,
                    track_points    = EXCLUDED.track_points,
                    updated_at      = now()
      RETURNING required_points, covered_points
      `,
      [companyId, date]
    );

    const covered = rows.reduce((sum: number, r: { covered_points: number }) => sum + Number(r.covered_points), 0);
    return { rows: rows.length, covered };
  }

  /** 覆蓋率查詢：讀統計表，不即時算 */
  public async pointCoverage(dto: PointCoverageQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.statRepo
      .createQueryBuilder('s')
      .leftJoin('s.project', 'p')
      .select('s.stat_date', 'DATE')
      .addSelect("COALESCE(p.prj_id, '未歸屬')", 'PRJ_ID')
      .addSelect("COALESCE(s.district, '未分區')", 'DISTRICT')
      .addSelect('s.required_points', 'REQUIRED')
      .addSelect('s.covered_points', 'COVERED')
      .addSelect('s.coverage_rate::float8', 'COVERAGE')
      .addSelect('s.track_points', 'TRACK_POINTS')
      .where('s.company_id = :companyId', { companyId })
      .andWhere('s.stat_date BETWEEN :start AND :end', { start: dto.DATE_START, end: dto.DATE_END })
      .orderBy('s.stat_date', 'DESC')
      .addOrderBy('s.district', 'ASC');

    if (dto.PROJECT_ID) qb.andWhere('s.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.DISTRICT) qb.andWhere('s.district = :district', { district: dto.DISTRICT });

    const rows = await qb.getRawMany<{ REQUIRED: number; COVERED: number; COVERAGE: number; TRACK_POINTS: number }>();

    const required = rows.reduce((s, r) => s + Number(r.REQUIRED), 0);
    const covered = rows.reduce((s, r) => s + Number(r.COVERED), 0);

    return HttpResponse.successOrWarn({
      data: {
        ROWS: rows,
        REQUIRED: required,
        COVERED: covered,
        COVERAGE: required ? Number(((covered / required) * 100).toFixed(1)) : 0,
        // 覆蓋率是 0 時要分得出「沒出車」與「出車但沒到點」——
        // 前者是調度問題，後者是路線規劃問題
        NO_TRACK_DAYS: rows.filter((r) => Number(r.TRACK_POINTS) === 0).length
      },
      isEmpty: (v) => !v?.ROWS?.length,
      warnMsg: '這個範圍還沒有覆蓋率統計；統計由排程每小時產生'
    });
  }

  /**
   * 手繪路線查詢。
   *
   * 在圖台上畫一條線，問「這條路線上有哪些巡查點、線段與案件」——
   * 規劃新巡查路線時要先知道它會經過什麼。
   */
  public async drawRoute(dto: DrawRouteDto, companyId: number): Promise<HttpResult> {
    const buffer = dto.BUFFER_M ?? 50;
    const wkt = `LINESTRING(${dto.ROUTE.map(([lng, lat]) => `${lng} ${lat}`).join(',')})`;

    const [points, lines, cases] = await Promise.all([
      this.dataSource.query(
        `SELECT p.id, p.code, p.name, p.district, ST_AsGeoJSON(p.geom)::json AS geometry
           FROM patrol_points p
          WHERE p.company_id = $1 AND p.is_active = true
            AND ST_DWithin(p.geom, ST_GeogFromText($2), $3)
          ORDER BY p.code LIMIT 500`,
        [companyId, `SRID=4326;${wkt}`, buffer]
      ),
      this.dataSource.query(
        `SELECT l.id, l.code,
                COALESCE(NULLIF(l.display_name, ''), NULLIF(l.road_name, ''), '(無名路段)') AS label,
                l.district, l.jurisdiction, l.is_active,
                ST_AsGeoJSON(l.geom)::json AS geometry
           FROM road_lines l
          WHERE l.company_id = $1
            AND ST_DWithin(l.geom, ST_GeogFromText($2), $3)
          ORDER BY l.code LIMIT 1000`,
        [companyId, `SRID=4326;${wkt}`, buffer]
      ),
      this.dataSource.query(
        `SELECT c.id, c.case_num AS "caseNum", c.crack_type AS "crackType", c.degree,
                ad.road, COALESCE(st.need_repair, 0) AS "needRepair",
                ST_AsGeoJSON(c.geom)::json AS geometry
           FROM patrol_cases c
           LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
           LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
          WHERE c.company_id = $1
            AND ST_DWithin(c.geom, ST_GeogFromText($2), $3)
          ORDER BY c.dt_record DESC LIMIT 1000`,
        [companyId, `SRID=4326;${wkt}`, buffer]
      )
    ]);

    return HttpResponse.successOrWarn({
      data: {
        BUFFER_M: buffer,
        POINTS: this.toFeatureCollection(points),
        LINES: this.toFeatureCollection(lines),
        CASES: this.toFeatureCollection(cases),
        SUMMARY: { POINTS: points.length, LINES: lines.length, CASES: cases.length }
      },
      isEmpty: (v) => !v?.SUMMARY?.POINTS && !v?.SUMMARY?.LINES && !v?.SUMMARY?.CASES,
      warnMsg: '這條路線附近沒有任何圖徵'
    });
  }

  // ═══ 內部 ═══════════════════════════════════════════════════════

  /** 空間條件；三種圖徵共用，差別只在路名欄位叫什麼 */
  private applyScope(
    qb: SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    dto: { COUNTY?: string; DISTRICT?: string[]; ROAD_NAME?: string; BBOX?: number[] },
    roadColumn = 'road_name'
  ): void {
    if (dto.COUNTY) qb.andWhere(`${alias}.county = :county`, { county: dto.COUNTY });
    if (dto.DISTRICT?.length) qb.andWhere(`${alias}.district IN (:...district)`, { district: dto.DISTRICT });
    if (dto.ROAD_NAME) qb.andWhere(`${alias}.${roadColumn} ILIKE :road`, { road: `%${dto.ROAD_NAME}%` });

    // 視野過濾：圖台縮到某一區時，沒必要把整個城市的圖徵送過去
    if (dto.BBOX?.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = dto.BBOX;
      qb.andWhere(`${alias}.geom && ST_MakeEnvelope(:minLng, :minLat, :maxLng, :maxLat, 4326)::geography`, {
        minLng,
        minLat,
        maxLng,
        maxLat
      });
    }
  }

  /** 原始查詢結果 → GeoJSON；圖台的每一種圖層走同一個格式 */
  private toFeatureCollection(rows: { geometry: unknown; [k: string]: unknown }[]) {
    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties }))
    };
  }
}
