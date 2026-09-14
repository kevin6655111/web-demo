import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressPoint } from './entities/address-point.entity';
import { AddressGrid } from './entities/address-grid.entity';

/** 反查結果；查無門牌時各欄位為 null，由呼叫端決定顯示方式 */
export type ResolvedAddress = {
  fullAddress: string | null;
  county: string | null;
  district: string | null;
  cavlge: string | null;
  road: string | null;
  number: string | null;
  distanceM: number | null;
};

/** 網格邊長（度）。0.01 度約 1.1 公里，與外部圖資服務的供應單位相當 */
const GRID_SIZE = 0.01;

/** 反查時的搜尋半徑（公尺）。超出此距離的門牌不足以代表該座標 */
const LOOKUP_RADIUS_M = 150;

@Injectable()
export class LocationService {
  private readonly logger = new Logger('Location');

  constructor(
    @InjectRepository(AddressPoint) private readonly pointRepo: Repository<AddressPoint>,
    @InjectRepository(AddressGrid) private readonly gridRepo: Repository<AddressGrid>
  ) {}

  /**
   * 座標反查地址。
   *
   * 取搜尋半徑內最近的門牌。半徑上限的意義在於「查無結果」也是一種正確結果 ——
   * 不設上限時，山區的一筆座標會對應到十公里外的門牌，而那個地址會被寫進案件、
   * 印上公文。寧可留白，也不要填入錯誤的地址。
   *
   * 距離計算使用 `geography` 型別，單位即為公尺，不需自行換算投影。
   */
  public async reverse(lng: number, lat: number): Promise<ResolvedAddress> {
    const [row] = await this.pointRepo.query(
      `SELECT full_address AS "fullAddress", county, district, cavlge, road, number,
              ST_Distance(geom, ST_MakePoint($1, $2)::geography) AS "distanceM"
         FROM address_points
        WHERE ST_DWithin(geom, ST_MakePoint($1, $2)::geography, $3)
        ORDER BY geom <-> ST_MakePoint($1, $2)::geography
        LIMIT 1`,
      [lng, lat, LOOKUP_RADIUS_M]
    );

    if (!row)
      return {
        fullAddress: null,
        county: null,
        district: null,
        cavlge: null,
        road: null,
        number: null,
        distanceM: null
      };

    return { ...row, distanceM: Math.round(Number(row.distanceM)) };
  }

  /**
   * 地址自動完成。
   *
   * 以「路名 + 門牌」為單位比對，回傳去重後的路段而非逐筆門牌 ——
   * 使用者輸入「中山」時要看到的是幾條路，不是中山路上的三百個門牌。
   */
  public async autoComplete(
    keyword: string,
    limit = 10
  ): Promise<{ label: string; county: string; district: string; road: string }[]> {
    const trimmed = keyword?.trim();
    if (!trimmed || trimmed.length < 2) return [];

    return await this.pointRepo.query(
      `SELECT DISTINCT county || district || road AS label, county, district, road
         FROM address_points
        WHERE road ILIKE $1
        ORDER BY label
        LIMIT $2`,
      [`%${trimmed}%`, limit]
    );
  }

  /**
   * 地址正查座標。
   *
   * 完整比對不到時退回同路段的任一門牌 —— 使用者輸入的門牌號常有誤差
   * （「99 號」與「99-1 號」），定位到同一條路上已足以支援現場作業。
   */
  public async forward(address: string): Promise<{ lng: number; lat: number; matched: string; exact: boolean } | null> {
    const trimmed = address?.trim();
    if (!trimmed) return null;

    const [exact] = await this.pointRepo.query(
      `SELECT ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat, full_address AS matched
         FROM address_points WHERE full_address = $1 LIMIT 1`,
      [trimmed]
    );
    if (exact) return { ...exact, lng: Number(exact.lng), lat: Number(exact.lat), exact: true };

    const [loose] = await this.pointRepo.query(
      `SELECT ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat, full_address AS matched
         FROM address_points WHERE $1 ILIKE '%' || road || '%' LIMIT 1`,
      [trimmed]
    );

    return loose ? { ...loose, lng: Number(loose.lng), lat: Number(loose.lat), exact: false } : null;
  }

  /**
   * 標記某座標所屬網格已完成圖資載入。
   *
   * 正式環境中，門牌來自有流量限制的外部服務，因此以網格為單位載入並記錄進度。
   * 查無門牌的網格同樣要記錄 —— 否則空白區域會在每次查詢時重新請求一次。
   */
  public async markGridLoaded(lng: number, lat: number, pointCount: number): Promise<void> {
    const gridX = Math.floor(lng / GRID_SIZE);
    const gridY = Math.floor(lat / GRID_SIZE);

    await this.gridRepo.query(
      `INSERT INTO address_grids (grid_x, grid_y, point_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (grid_x, grid_y)
       DO UPDATE SET point_count = EXCLUDED.point_count, loaded_at = now()`,
      [gridX, gridY, pointCount]
    );
  }

  /** 該座標所屬網格是否已載入過圖資 */
  public async isGridLoaded(lng: number, lat: number): Promise<boolean> {
    const gridX = Math.floor(lng / GRID_SIZE);
    const gridY = Math.floor(lat / GRID_SIZE);

    return (await this.gridRepo.count({ where: { gridX, gridY } })) > 0;
  }

  /** 門牌與網格的涵蓋統計；維運用來確認圖資載入範圍 */
  public async coverage(): Promise<{ points: number; grids: number; districts: number }> {
    const [row] = await this.pointRepo.query(
      `SELECT (SELECT COUNT(*)::int FROM address_points)                    AS points,
              (SELECT COUNT(*)::int FROM address_grids)                     AS grids,
              (SELECT COUNT(DISTINCT district)::int FROM address_points)    AS districts`
    );

    return row;
  }
}
