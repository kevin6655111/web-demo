import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LocationService } from '@/location/location.service';
import { RedisService } from '@/redis/redis.service';
import { Repository } from 'typeorm';
import { PatrolCase } from '@entities/patrol-case.entity';

/** 附近案件查詢結果 */
export type NearbyCase = {
  id: number;
  externalId: string;
  crackType: string;
  status: string;
  roadName: string | null;
  distanceM: number;
};

/**
 * 空間查詢：全部走 PostGIS，不在 Node 端算距離。
 * geography 型別的距離單位就是公尺，不必自己換算投影。
 */
/** 行政區界線的快取存活時間；界線是粗略近似值，十分鐘的落差不影響用途 */
const BOUNDS_CACHE_TTL_MS = 10 * 60_000;

@Injectable()
export class GeoService {
  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    private readonly locationService: LocationService,
    private readonly redisService: RedisService
  ) {}

  /**
   * 查詢指定座標半徑內的案件。
   * ST_DWithin 吃得到 GiST 索引；先算 ST_Distance 再過濾會全表掃描。
   */
  public async findNearby(lng: number, lat: number, radiusM: number, companyId: number): Promise<NearbyCase[]> {
    const rows = await this.caseRepo
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .addSelect('c.external_id', 'externalId')
      .addSelect('c.crack_type', 'crackType')
      .addSelect('c.status', 'status')
      .addSelect('c.road_name', 'roadName')
      .addSelect('ST_Distance(c.geom, ST_MakePoint(:lng, :lat)::geography)', 'distanceM')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('ST_DWithin(c.geom, ST_MakePoint(:lng, :lat)::geography, :radiusM)')
      .orderBy('"distanceM"', 'ASC')
      .limit(200)
      .setParameters({ lng, lat, radiusM })
      .getRawMany<NearbyCase & { distanceM: string }>();

    return rows.map((r) => ({ ...r, distanceM: Math.round(Number(r.distanceM)) }));
  }

  /**
   * 行政區界線。
   *
   * 從案件資料反推：把同一個行政區的案件取凸包(convex hull)當作粗略界線。
   * 正式系統接的是國土測繪中心的行政區圖資，但那份資料有幾十 MB，
   * 放進示範專案不合理 —— 而這個近似值足以示範「界線圖層」這件事。
   */
  public async getDistrictBounds(companyId: number): Promise<unknown> {
    // 凸包聚合的成本隨案件數線性成長：1,800 筆時 15 ms，9 萬筆時 110 ms，
    // 而這是圖台每次開啟都會呼叫的端點。
    //
    // 用 TTL 而非事件失效：界線由案件位置推導，案件持續新增，
    // 事件失效會讓快取幾乎不生效。而界線本身是粗略近似值 ——
    // 晚十分鐘反映新案件不影響它的用途。
    const { value } = await this.redisService.remember(`geo:bounds:${companyId}`, BOUNDS_CACHE_TTL_MS, () =>
      this.computeDistrictBounds(companyId)
    );

    return value;
  }

  private async computeDistrictBounds(companyId: number): Promise<unknown> {
    const rows = await this.caseRepo.query(
      `
      SELECT ad.district,
             COUNT(*)::int AS case_count,
             ST_AsGeoJSON(ST_ConvexHull(ST_Collect(c.geom::geometry)))::json AS geometry
        FROM patrol_cases c
        -- 行政區在地址表而非主表：主表只放車機寫進來的內容，
        -- 地址是逆地理編碼之後才補上的
        JOIN patrol_case_addresses ad ON ad.case_id = c.id
       WHERE c.company_id = $1
         AND ad.district IS NOT NULL
       GROUP BY ad.district
        -- 少於三點的凸包會退化成線或點，畫不出面
      HAVING COUNT(*) >= 3
      `,
      [companyId]
    );

    return {
      type: 'FeatureCollection',
      features: rows.map((r: { district: string; case_count: number; geometry: unknown }) => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: { district: r.district, caseCount: r.case_count }
      }))
    };
  }

  /**
   * 地址自動完成。
   *
   * 資料來源是既有案件的路名與地址 —— 承辦要找的地點，多半是出過案件的地方。
   * 正式系統接的是 NLSC 的地址比對服務，但那需要金鑰且有流量限制。
   */
  public async autoComplete(keyword: string, companyId: number): Promise<unknown[]> {
    if (!keyword || keyword.length < 1) return [];

    return await this.caseRepo.query(
      `
      SELECT label, lng, lat, hits FROM (
        SELECT COALESCE(address, road_name) AS label,
               ST_X(ST_Centroid(ST_Collect(geom::geometry))) AS lng,
               ST_Y(ST_Centroid(ST_Collect(geom::geometry))) AS lat,
               COUNT(*)::int AS hits
          FROM patrol_cases
         WHERE company_id = $1
           AND COALESCE(address, road_name) ILIKE $2
         GROUP BY COALESCE(address, road_name)
      ) s
       ORDER BY hits DESC
       LIMIT 10
      `,
      [companyId, `%${keyword}%`]
    );
  }

  /**
   * 逆地理編碼(取得路名)。
   *
   * 優先查詢 `location` 模組的門牌圖資；查無門牌時退回決定性的假路名。
   *
   * 保留退路的原因：門牌圖資的涵蓋範圍不會等於案件的分布範圍，
   * 山區與新闢道路查不到門牌是常態。此時仍需給案件一個穩定的路名，
   * 否則同一筆案件在佇列重試時會寫進不同的值。
   */
  public async reverseGeocode(lng: number, lat: number): Promise<string> {
    const resolved = await this.locationService.reverse(lng, lat);
    if (resolved.road) return resolved.road;

    return this.syntheticRoad(lng, lat);
  }

  /**
   * 查無門牌時的替代路名。
   *
   * 由座標網格推導，因此同一座標永遠得到同一個結果 ——
   * 佇列重試不會每次寫進不同的值。
   */
  private syntheticRoad(lng: number, lat: number): string {
    const grid = `${Math.floor(lng * 200)}:${Math.floor(lat * 200)}`;
    const roads = ['中山路', '民生路', '建國路', '文心路', '中港路', '成功路', '和平路', '光復路'];
    const sections = ['一段', '二段', '三段', '四段'];

    let hash = 0;
    for (const ch of grid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

    // 位移一律用 >>>：>> 是有號位移，雜湊值超過 2^31 時會變成負數，
    // 取餘數後索引為負，陣列取值就會拿到 undefined
    return `${roads[hash % roads.length]}${sections[(hash >>> 5) % sections.length]}`;
  }
}
