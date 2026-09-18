import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LocationService } from '@/location/location.service';
import { RedisService } from '@/redis/redis.service';
import { Repository } from 'typeorm';
import { PatrolCase } from '@entities/patrol-case.entity';
import { GisRegion, type RegionLevel } from './entities/gis-region.entity';
import { RoadMeas } from './entities/road-meas.entity';
import { Building } from './entities/building.entity';

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

/**
 * 行政區界線的快取期限。
 *
 * 一天，而不是十分鐘：界線是**一年動一次**的資料，
 * 短期限只會讓同一份幾何反覆重新序列化。
 *
 * 不設成永久是因為快取要有自癒能力 —— 圖資更新後忘了清快取的話，
 * 永久快取要靠有人發現才會修好。
 */
const REGION_CACHE_TTL_MS = 24 * 60 * 60_000;

/** 界線快取的鍵前綴；圖資更新後用它整批清掉 */
export const REGION_CACHE_PREFIX = 'geo:region:';

@Injectable()
export class GeoService {
  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(GisRegion) private readonly regionRepo: Repository<GisRegion>,
    @InjectRepository(RoadMeas) private readonly roadMeasRepo: Repository<RoadMeas>,
    @InjectRepository(Building) private readonly buildingRepo: Repository<Building>,
    private readonly locationService: LocationService,
    private readonly redisService: RedisService
  ) {}

  /**
   * 行政區界線圖層。
   *
   * 有真的圖資就用真的；沒有才退回「從案件位置取凸包」的近似值。
   *
   * 凸包的兩個問題讓它只能當退路：沒有案件的區域畫不出來，
   * 而且案件一多，凸包會把不相鄰的兩塊連成一片 —— 圖台上會出現
   * 一個橫跨整個城市的假行政區。
   */
  public async getRegionLayer(level: RegionLevel, filter: { county?: string; district?: string }): Promise<unknown> {
    // 界線是全公司共用的公開圖資，不含任何租戶資料，所以鍵裡不帶 companyId ——
    // 每個公司各存一份完全相同的幾何，只是把 Redis 的記憶體乘上公司數
    const cacheKey = `${REGION_CACHE_PREFIX}${level}:${filter.county ?? ''}:${filter.district ?? ''}`;

    const { value } = await this.redisService.remember(cacheKey, REGION_CACHE_TTL_MS, () =>
      this.queryRegionLayer(level, filter)
    );

    return value;
  }

  /**
   * 預熱界線快取。
   *
   * 界線是**開機就能算、算完一整天不變**的資料。不預熱的話，
   * 付出那 6~600 ms 的是「今天第一個打開圖台的人」——
   * 而那個人通常是早上七點準備出勤的巡查員，正是最沒有時間等的那一個。
   *
   * 只預熱三個層級的全域查詢：帶了縣市/行政區條件的組合有幾十種，
   * 全部預熱等於把整份圖資塞進 Redis，而那些組合多數沒有人會用到。
   *
   * 失敗不拋例外 —— 預熱失敗只是「第一個人要多等一下」，不是故障。
   */
  public async warmRegionCache(): Promise<{ level: RegionLevel; features: number }[]> {
    const levels: RegionLevel[] = ['COUNTY', 'DISTRICT', 'VILLAGE'];
    const warmed: { level: RegionLevel; features: number }[] = [];

    for (const level of levels) {
      const layer = (await this.getRegionLayer(level, {})) as { features?: unknown[] };
      warmed.push({ level, features: layer.features?.length ?? 0 });
    }

    return warmed;
  }

  /** 界線查詢本體；與快取分開，讓預熱可以直接呼叫它 */
  private async queryRegionLayer(level: RegionLevel, filter: { county?: string; district?: string }): Promise<unknown> {
    const qb = this.regionRepo
      .createQueryBuilder('r')
      .select('r.id', 'id')
      .addSelect('r.county', 'county')
      .addSelect('r.district', 'district')
      .addSelect('r.village', 'village')
      .addSelect('r.level', 'level')
      .addSelect('r.area_km2::float8', 'areaKm2')
      .addSelect(
        "COALESCE(NULLIF(r.village, ''), NULLIF(r.district, ''), r.county)",
        'label'
      )
      .addSelect('ST_AsGeoJSON(r.geom)::json', 'geometry')
      .where('r.level = :level', { level })
      .limit(3000);

    if (filter.county) qb.andWhere('r.county = :county', { county: filter.county });
    if (filter.district) qb.andWhere('r.district = :district', { district: filter.district });

    const rows = await qb.getRawMany<{ geometry: unknown; [k: string]: unknown }>();

    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties }))
    };
  }

  /**
   * 座標落在哪一個行政區。
   *
   * 由小到大回傳(里 → 區 → 縣市)：呼叫端要的通常是最細的那一層，
   * 但界線資料不見得完整到里，所以要能退到區。
   *
   * 用 `ST_Intersects` 而不是 `ST_Contains`：**`ST_Contains` 不包含邊界**，
   * 而剛好落在兩個里交界上的點並不罕見 —— 路口、河道中線、道路中心線
   * 常常就是行政區的界。用 Contains 的話，那些點會得到「不在任何行政區內」，
   * 而那是錯的答案而不是誠實的答案。
   *
   * 代價是邊界上的點會同時命中兩個面。用面積小的優先解決：
   * 面積小的是比較具體的那一個，而同一層級裡先選哪一個都是任意的 ——
   * 重點是**同一個座標永遠得到同一個答案**，否則同一筆案件重跑會換一個里。
   */
  public async whichRegion(lng: number, lat: number): Promise<{
    county: string | null;
    district: string | null;
    village: string | null;
  }> {
    const rows = await this.regionRepo.query(
      `SELECT level, county, district, village
         FROM gis_regions
        WHERE ST_Intersects(geom::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        ORDER BY CASE level WHEN 'VILLAGE' THEN 0 WHEN 'DISTRICT' THEN 1 ELSE 2 END,
                 area_km2 ASC NULLS LAST,
                 id ASC`,
      [lng, lat]
    );

    const pick = (level: string, field: string) =>
      (rows.find((r: Record<string, string>) => r.level === level)?.[field] as string | undefined) ?? null;

    return {
      village: pick('VILLAGE', 'village'),
      district: pick('VILLAGE', 'district') ?? pick('DISTRICT', 'district'),
      county: pick('VILLAGE', 'county') ?? pick('DISTRICT', 'county') ?? pick('COUNTY', 'county')
    };
  }

  /**
   * 建物圖層。
   *
   * 巡查系統要它做什麼：**判斷施工影響範圍**。一個要封街刨鋪的路段，
   * 旁邊是住宅還是廠區，決定施工時段與交維方式。
   *
   * 回傳輪廓與樓高。**沒有做真正的 3D 拉伸** —— 那需要 deck.gl 或
   * MapLibre 這類支援 WebGL 的繪圖層，而為了一個判讀用的輔助圖層
   * 多背 500 KB 的前端依賴並不划算。樓高以顏色深淺表達，
   * 點開可以看到實際樓層數。這是刻意的取捨，不是做不到。
   */
  public async getBuildingLayer(filter: {
    district?: string;
    usage?: string;
    minLevels?: number;
    bbox?: number[];
  }): Promise<unknown> {
    const qb = this.buildingRepo
      .createQueryBuilder('b')
      .select('b.id', 'id')
      .addSelect('b.name', 'name')
      .addSelect('b.usage', 'usage')
      .addSelect('b.levels', 'levels')
      .addSelect('b.height_m::float8', 'heightM')
      .addSelect('b.area_m2::float8', 'areaM2')
      .addSelect('b.district', 'district')
      .addSelect('ST_AsGeoJSON(b.geom)::json', 'geometry')
      // 高的先畫：矮的疊在上面才看得到，否則大樓會把旁邊的透天蓋掉
      .orderBy('b.levels', 'DESC')
      .limit(4000);

    if (filter.district) qb.andWhere('b.district = :district', { district: filter.district });
    if (filter.usage) qb.andWhere('b.usage = :usage', { usage: filter.usage });
    if (filter.minLevels) qb.andWhere('b.levels >= :minLevels', { minLevels: filter.minLevels });

    if (filter.bbox?.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = filter.bbox;
      qb.andWhere('b.geom && ST_MakeEnvelope(:minLng, :minLat, :maxLng, :maxLat, 4326)::geography', {
        minLng,
        minLat,
        maxLng,
        maxLat
      });
    }

    const rows = await qb.getRawMany<{ geometry: unknown; [k: string]: unknown }>();

    return {
      type: 'FeatureCollection',
      features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties }))
    };
  }

  /**
   * 某個位置周邊的建物統計。
   *
   * 派工單要回答的是「這裡施工會影響誰」：附近有幾戶住宅、有沒有學校或醫院。
   * 這個數字決定交維計畫要不要送審。
   */
  public async buildingImpact(lng: number, lat: number, radiusM = 100): Promise<unknown> {
    const rows = await this.buildingRepo.query(
      `SELECT usage, COUNT(*)::int AS count, ROUND(SUM(area_m2)::numeric, 0)::float8 AS area
         FROM buildings
        WHERE ST_DWithin(geom, ST_MakePoint($1, $2)::geography, $3)
        GROUP BY usage
        ORDER BY count DESC`,
      [lng, lat, radiusM]
    );

    const sensitive = rows.filter((r: { usage: string }) => ['SCHOOL', 'HOSPITAL'].includes(r.usage));

    return {
      RADIUS_M: radiusM,
      BY_USAGE: rows,
      TOTAL: rows.reduce((s: number, r: { count: number }) => s + Number(r.count), 0),
      // 學校與醫院是要另外處理的：前者要避開上下學，後者不能封死出入口
      SENSITIVE: sensitive.reduce((s: number, r: { count: number }) => s + Number(r.count), 0),
      NOTE: sensitive.length ? '周邊有學校或醫院，施工時段與交維方式需另行評估' : null
    };
  }

  /**
   * 道路量測資料查詢。
   *
   * 計價的分母：契約寫「每平方公尺多少錢」，而面積 = 長度 × 寬度。
   */
  public async listRoadMeas(filter: { county?: string; district?: string; keyword?: string }): Promise<unknown[]> {
    const qb = this.roadMeasRepo
      .createQueryBuilder('m')
      .orderBy('m.road_num', 'ASC')
      .limit(1000);

    if (filter.county) qb.andWhere('m.county = :county', { county: filter.county });
    if (filter.district) qb.andWhere('m.district = :district', { district: filter.district });
    if (filter.keyword) {
      qb.andWhere('(m.road_name ILIKE :kw OR m.road_num ILIKE :kw)', { kw: `%${filter.keyword}%` });
    }

    const rows = await qb.getMany();

    return rows.map((m) => ({
      ID: m.id,
      COUNTY: m.county,
      DISTRICT: m.district ?? null,
      ROAD_NUM: m.roadNum,
      ROAD_NAME: m.roadName,
      LENGTH_M: Number(m.lengthM),
      WIDTH_M: Number(m.widthM),
      LANE_COUNT: m.laneCount,
      PAVEMENT: m.pavement,
      // 面積直接算好回去：每個呼叫端各乘一次的話，四捨五入的時機會不一樣
      AREA_M2: Number((Number(m.lengthM) * Number(m.widthM)).toFixed(2))
    }));
  }

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
    // 有真的行政區圖資就用它：凸包近似值只是沒有圖資時的退路
    const real = await this.regionRepo.count({ where: { level: 'DISTRICT' } });
    if (real > 0) return await this.getRegionLayer('DISTRICT', {});

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
