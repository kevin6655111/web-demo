import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@/redis/redis.service';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';

const LAYER_TTL_MS = 5 * 60_000;

export type LayerQuery = {
  companyId: number;
  /** 二篩狀態(0-4) */
  status?: number;
  /** 修繕狀態(-1..2) */
  needRepair?: number;
  crackType?: string;
  degree?: string;
  county?: string;
  district?: string;
  prjId?: string;
  car?: string;
  bbox?: [number, number, number, number];
};

/**
 * 圖層載入。
 *
 * 跑在獨立行程的理由很具體：一次全市圖層是幾 MB 的 JSON，
 * 序列化的時候會把 event loop 佔住 —— 同一個行程裡的登入請求會跟著卡。
 * 拆出去之後，圖層再慢也只慢它自己。
 *
 * GeoJSON 由 PostGIS 直接組(ST_AsGeoJSON)，不在 Node 端拼字串：
 * 資料庫做這件事快得多，也不會為了組 JSON 把整批資料搬進記憶體。
 */
@Injectable()
export class TilesService {
  private readonly logger = new Logger('Tiles');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    private readonly redisService: RedisService
  ) {}

  /** 取得案件圖層(GeoJSON FeatureCollection) */
  public async getCaseLayer(query: LayerQuery): Promise<{ layer: unknown; cached: boolean }> {
    const cacheKey = this.makeCacheKey(query);

    const cached = await this.redisService.get(cacheKey);
    if (cached) return { layer: JSON.parse(cached), cached: true };

    const params: unknown[] = [query.companyId];
    const where: string[] = ['c.company_id = $1'];

    // 狀態在分表，而且允許沒有狀態列(剛進來還沒二篩) —— 所以是 LEFT JOIN + COALESCE，
    // 用 INNER JOIN 會讓最新進來的案件從圖層上消失
    if (query.status !== undefined) {
      params.push(query.status);
      where.push(`COALESCE(st.status, 0) = $${params.length}`);
    }

    if (query.needRepair !== undefined) {
      params.push(query.needRepair);
      where.push(`COALESCE(st.need_repair, 0) = $${params.length}`);
    }

    if (query.crackType) {
      params.push(query.crackType);
      where.push(`c.crack_type = $${params.length}`);
    }

    if (query.degree) {
      params.push(query.degree);
      where.push(`c.degree = $${params.length}`);
    }

    if (query.county) {
      params.push(query.county);
      where.push(`ad.county = $${params.length}`);
    }

    if (query.district) {
      params.push(query.district);
      where.push(`ad.district = $${params.length}`);
    }

    if (query.prjId) {
      params.push(query.prjId);
      where.push(`p.prj_id = $${params.length}`);
    }

    if (query.car) {
      params.push(query.car);
      where.push(`c.car = $${params.length}`);
    }

    if (query.bbox) {
      // bbox 過濾要走 GiST 索引，所以用 && 而不是先算出所有點再比較
      params.push(...query.bbox);
      const n = params.length;
      where.push(`c.geom::geometry && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`);
    }

    const rows = await this.caseRepo.query(
      `
      SELECT json_build_object(
               'type', 'FeatureCollection',
               'features', COALESCE(json_agg(f.feature), '[]'::json)
             ) AS layer
        FROM (
          SELECT json_build_object(
                   'type', 'Feature',
                   'geometry', ST_AsGeoJSON(c.geom)::json,
                   'properties', json_build_object(
                     'id', c.id,
                     'caseNum', c.case_num,
                     'externalId', c.external_id,
                     'crackType', c.crack_type,
                     'degree', c.degree,
                     'status', COALESCE(st.status, 0),
                     'needRepair', COALESCE(st.need_repair, 0),
                     'roadName', ad.road,
                     'address', ad.address,
                     'district', ad.district,
                     'car', c.car,
                     'area', c.area,
                     'detectedAt', c.dt_record
                   )
                 ) AS feature
            FROM patrol_cases c
            LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
            LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
            LEFT JOIN projects p ON p.id = c.project_id
           WHERE ${where.join(' AND ')}
           LIMIT 20000
        ) f
      `,
      params
    );

    const layer = rows?.[0]?.layer ?? { type: 'FeatureCollection', features: [] };
    await this.redisService.setJson(cacheKey, layer, LAYER_TTL_MS);

    return { layer, cached: false };
  }

  /**
   * 向量圖磚(Mapbox Vector Tile)。
   *
   * 為什麼在 GeoJSON 之外還要這個：全市案件的 GeoJSON 是好幾 MB，
   * 而且每次平移地圖都要重下載。圖磚只傳「這一格」的資料，
   * 而且瀏覽器會自己快取已經看過的格子。
   *
   * 圖磚由 PostGIS 直接產生(ST_AsMVT)，Node 端只負責轉手 ——
   * 在應用層裁切幾何是把資料庫最擅長的事搬到最不擅長的地方做。
   */
  public async getCaseTile(z: number, x: number, y: number, companyId: number, status?: number): Promise<Buffer> {
    const cacheKey = `mvt:case:${companyId}:${status ?? 'all'}:${z}/${x}/${y}`;

    const cached = await this.redisService.client.getBuffer(cacheKey);
    if (cached) return cached;

    const rows = await this.caseRepo.query(
      `
      WITH bounds AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS geom
      ), mvt_data AS (
        SELECT c.id,
               c.case_num,
               c.external_id,
               c.crack_type,
               c.degree,
               COALESCE(st.status, 0) AS status,
               COALESCE(st.need_repair, 0) AS need_repair,
               ad.road,
               c.area::float8 AS area,
               -- 幾何要先轉到圖磚的投影(3857)：ST_AsMVTGeom 要求兩者同座標系，
               -- 不轉的話不會報錯，只會安靜地回傳空圖磚 —— 最難查的那種問題
               -- 4096 是 MVT 的標準解析度；buffer 64 讓跨格的點在兩格都畫得出來，
               -- 否則圖磚邊界上的點會在平移時忽隱忽現
               ST_AsMVTGeom(ST_Transform(c.geom::geometry, 3857), bounds.geom, 4096, 64, true) AS geom
          FROM patrol_cases c
          CROSS JOIN bounds
          LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
          LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
         WHERE c.company_id = $4
           AND ($5::int IS NULL OR COALESCE(st.status, 0) = $5)
           AND c.geom::geometry && ST_Transform(bounds.geom, 4326)
      )
      SELECT ST_AsMVT(mvt_data, 'cases', 4096, 'geom') AS tile FROM mvt_data WHERE geom IS NOT NULL
      `,
      [z, x, y, companyId, status ?? null]
    );

    const tile: Buffer = rows?.[0]?.tile ?? Buffer.alloc(0);

    // 圖磚是不可變的：同一格的內容只有在資料變動時才會不同，
    // 所以快取時間可以拉長，用資料變動時清快取來保證新鮮度
    await this.redisService.client.set(cacheKey, tile, 'PX', 10 * 60_000);

    return tile;
  }

  /**
   * 預熱快取(排程 tilesWarmup 呼叫)。
   * 上班前先把圖層算好，第一個開看板的人就不用等那五秒。
   */
  public async warmup(companyId: number): Promise<number> {
    // 預熱最常開的四種：全部、待判定、需修繕、已派工 ——
    // 這是承辦早上進系統會點的順序
    const variants: LayerQuery[] = [
      { companyId },
      { companyId, needRepair: 0 },
      { companyId, needRepair: 1 },
      { companyId, needRepair: 2 }
    ];

    for (const v of variants) {
      await this.redisService.del(this.makeCacheKey(v)); // 預熱要算新的，不是把舊的再放一次
      await this.getCaseLayer(v);
    }

    this.logger.log(`🔥 圖層預熱完成，共 ${variants.length} 組`);
    return variants.length;
  }

  private makeCacheKey(query: LayerQuery): string {
    const bbox = query.bbox ? query.bbox.map((n) => n.toFixed(3)).join(',') : 'all';
    const filters = [
      query.status ?? 'a',
      query.needRepair ?? 'a',
      query.crackType ?? 'a',
      query.degree ?? 'a',
      query.county ?? 'a',
      query.district ?? 'a',
      query.prjId ?? 'a',
      query.car ?? 'a'
    ].join('-');

    return `layer:case:${query.companyId}:${filters}:${bbox}`;
  }
}
