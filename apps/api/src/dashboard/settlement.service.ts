import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '@/storage/storage.service';

/** 逾期的定義：限期已過而且還沒完工 */
const ORDER_STATUS = { DELETED: -1, PENDING: 0, WORKING: 1, REPORTED: 2, DONE: 3 } as const;

/** 每日檢查一次最多抽驗幾張照片；全部驗會讓一次結算跑上幾分鐘 */
const IMAGE_SAMPLE_LIMIT = 50;

export type SettleResult = { rows: number; date: string };

/**
 * 結算。
 *
 * 三件事共用同一個模式：**掃一段時間、依維度彙總、覆寫寫入**。
 * 覆寫（`ON CONFLICT DO UPDATE`）而不是累加，所以補跑不會讓數字翻倍 ——
 * 排程沒有人盯著，重跑一次是常態而不是異常。
 *
 * 為什麼要落地而不是即時算：看板要的是「這個月每天每個行政區的量」，
 * 那要掃整月的軌跡點(每台車每天七千筆)。而看板是掛在牆上整天刷新的。
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger('Settlement');

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService
  ) {}

  /**
   * 巡查結算：里程、案件數、各破壞類型。
   *
   * 里程的算法與 `patrol/mileage` 一致 —— 兩邊各寫一份的話，
   * 看板上的里程與報表上的里程會對不起來，而業主兩份都會看到。
   */
  public async settleCases(companyId: number, date: string): Promise<SettleResult> {
    const rows = await this.dataSource.query(
      `
      WITH ordered AS (
        SELECT t.vehicle_id, t.project_id, t.geom::geometry AS geom, t.is_trip_start,
               LAG(t.geom::geometry) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) AS prev_geom
          FROM vehicle_tracks t
         WHERE t.company_id = $1 AND t.recorded_at >= $2::date AND t.recorded_at < $2::date + interval '1 day'
      ),
      legs AS (
        SELECT o.vehicle_id, o.project_id, o.geom,
               ST_Distance(o.geom::geography, o.prev_geom::geography) AS seg_m
          FROM ordered o
         WHERE o.prev_geom IS NOT NULL AND o.is_trip_start = false
           -- 大於 5 公尺才計入：車子停紅燈的兩分鐘會產生二十幾個重疊的點
           AND ST_Distance(o.geom::geography, o.prev_geom::geography) > 5
      ),
      mileage AS (
        SELECT l.project_id,
               a.county,
               a.district,
               SUM(l.seg_m) / 1000 AS km,
               COUNT(DISTINCT l.vehicle_id)::int AS vehicles
          FROM legs l
          -- 行政區由最近的案件地址推得：軌跡點本身沒有行政區，
          -- 而為了幾千個點各做一次逆地理編碼並不划算
          LEFT JOIN LATERAL (
            SELECT ad.county, ad.district
              FROM patrol_cases c
              JOIN patrol_case_addresses ad ON ad.case_id = c.id
             WHERE c.company_id = $1 AND ad.district IS NOT NULL
             ORDER BY c.geom <-> l.geom::geography
             LIMIT 1
          ) a ON true
         GROUP BY l.project_id, a.county, a.district
      ),
      cases AS (
        SELECT c.project_id,
               ad.county,
               ad.district,
               COUNT(*)::int                                                          AS total,
               COUNT(*) FILTER (WHERE c.crack_type = 'Potholes')::int                 AS pothole,
               COUNT(*) FILTER (WHERE c.crack_type = 'Alligator_Cracking')::int       AS alligator,
               COUNT(*) FILTER (WHERE c.crack_type = 'Cracking')::int                 AS linear,
               COUNT(*) FILTER (WHERE c.crack_type = 'Patch')::int                    AS patch,
               COUNT(*) FILTER (WHERE c.crack_type = 'Cover')::int                    AS cover,
               COUNT(*) FILTER (WHERE c.crack_type NOT IN
                 ('Potholes','Alligator_Cracking','Cracking','Patch','Cover'))::int   AS other,
               COALESCE(SUM(c.area), 0)                                               AS area
          FROM patrol_cases c
          LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
         WHERE c.company_id = $1 AND c.dt_record >= $2::date AND c.dt_record < $2::date + interval '1 day'
         GROUP BY c.project_id, ad.county, ad.district
      ),
      -- 全外連接：有里程沒案件(跑了但沒發現)與有案件沒里程(App 通報)都要留下
      merged AS (
        SELECT COALESCE(m.project_id, c.project_id) AS project_id,
               COALESCE(m.county, c.county)         AS county,
               COALESCE(m.district, c.district)     AS district,
               COALESCE(m.km, 0)                    AS km,
               COALESCE(m.vehicles, 0)              AS vehicles,
               COALESCE(c.total, 0)                 AS total,
               COALESCE(c.pothole, 0)               AS pothole,
               COALESCE(c.alligator, 0)             AS alligator,
               COALESCE(c.linear, 0)                AS linear,
               COALESCE(c.patch, 0)                 AS patch,
               COALESCE(c.cover, 0)                 AS cover,
               COALESCE(c.other, 0)                 AS other,
               COALESCE(c.area, 0)                  AS area
          FROM mileage m
          FULL OUTER JOIN cases c
            ON COALESCE(m.project_id, -1) = COALESCE(c.project_id, -1)
           AND COALESCE(m.district, '') = COALESCE(c.district, '')
      )
      INSERT INTO dashboard_case_stats
             (company_id, stat_date, project_id, county, district, mileage_km, patrol_days,
              case_total, pothole, alligator_crack, linear_crack, patch, manhole_cover, other_crack, area_m2, updated_at)
      SELECT $1, $2::date, project_id, county, district,
             ROUND(km::numeric, 2), vehicles, total, pothole, alligator, linear, patch, cover, other,
             ROUND(area::numeric, 2), now()
        FROM merged
      ON CONFLICT (company_id, stat_date, project_id, district)
      DO UPDATE SET mileage_km      = EXCLUDED.mileage_km,
                    patrol_days     = EXCLUDED.patrol_days,
                    case_total      = EXCLUDED.case_total,
                    pothole         = EXCLUDED.pothole,
                    alligator_crack = EXCLUDED.alligator_crack,
                    linear_crack    = EXCLUDED.linear_crack,
                    patch           = EXCLUDED.patch,
                    manhole_cover   = EXCLUDED.manhole_cover,
                    other_crack     = EXCLUDED.other_crack,
                    area_m2         = EXCLUDED.area_m2,
                    updated_at      = now()
      RETURNING id
      `,
      [companyId, date]
    );

    return { rows: rows.length, date };
  }

  /**
   * 派工結算。
   *
   * 日期指的是**派工日**而不是完工日：業主問的是「這批派出去的單做完了沒有」。
   * 所以同一天派出去的單，狀態會隨著時間變動 —— 這張表每天重算，不是只寫一次。
   */
  public async settleOrders(companyId: number, date: string): Promise<SettleResult> {
    const rows = await this.dataSource.query(
      `
      INSERT INTO dashboard_order_stats
             (company_id, stat_date, project_id, county, district, dispatched, in_progress, reported, done, overdue, updated_at)
      SELECT $1,
             $2::date,
             w.project_id,
             MIN(w.county),
             w.district,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE ws.status = ${ORDER_STATUS.WORKING})::int,
             COUNT(*) FILTER (WHERE ws.status = ${ORDER_STATUS.REPORTED})::int,
             COUNT(*) FILTER (WHERE ws.status = ${ORDER_STATUS.DONE})::int,
             -- 逾期：限期已過而且還沒完工。已刪除的單不算逾期
             COUNT(*) FILTER (
               WHERE w.due_date < CURRENT_DATE
                 AND ws.status BETWEEN ${ORDER_STATUS.PENDING} AND ${ORDER_STATUS.REPORTED}
             )::int,
             now()
        FROM work_orders w
        LEFT JOIN work_order_statuses ws ON ws.work_order_id = w.id
       WHERE w.company_id = $1 AND w.dispatch_date = $2::date
       GROUP BY w.project_id, w.district
      ON CONFLICT (company_id, stat_date, project_id, district)
      DO UPDATE SET dispatched  = EXCLUDED.dispatched,
                    in_progress = EXCLUDED.in_progress,
                    reported    = EXCLUDED.reported,
                    done        = EXCLUDED.done,
                    overdue     = EXCLUDED.overdue,
                    updated_at  = now()
      RETURNING id
      `,
      [companyId, date]
    );

    return { rows: rows.length, date };
  }

  /**
   * 每日上傳檢查。
   *
   * 督導早上要回答的是「昨天每一台車都有正常上傳嗎」。
   *
   * **照片是抽驗而不是全驗**：案件有 `img` 欄位不代表檔案真的在物件儲存上 ——
   * 車機在收訊差的地方常常送出了紀錄卻沒送出照片。但逐筆問物件儲存很慢，
   * 所以每一組抽最多 50 張，用抽樣的缺件率推估。
   */
  public async runDailyCheck(companyId: number, date: string): Promise<SettleResult> {
    const groups = await this.dataSource.query(
      `
      SELECT c.project_id                                        AS "projectId",
             COALESCE(c.car, '(未指定)')                         AS "car",
             ad.county                                           AS "county",
             ad.district                                         AS "district",
             COUNT(*)::int                                       AS "caseCount",
             COUNT(*) FILTER (WHERE c.img IS NOT NULL)::int      AS "imageTotal",
             MIN(c.dt_record)                                    AS "firstAt",
             MAX(c.dt_record)                                    AS "lastAt",
             (ARRAY_AGG(c.img ORDER BY c.id) FILTER (WHERE c.img IS NOT NULL))[1:${IMAGE_SAMPLE_LIMIT}] AS "sample"
        FROM patrol_cases c
        LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
       WHERE c.company_id = $1 AND c.dt_record >= $2::date AND c.dt_record < $2::date + interval '1 day'
       GROUP BY c.project_id, c.car, ad.county, ad.district
      `,
      [companyId, date]
    );

    const tracks = await this.dataSource.query(
      `
      SELECT v.plate_no AS "car", COUNT(*)::int AS "points"
        FROM vehicle_tracks t
        JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.company_id = $1 AND t.recorded_at >= $2::date AND t.recorded_at < $2::date + interval '1 day'
       GROUP BY v.plate_no
      `,
      [companyId, date]
    );
    const trackByCar = new Map<string, number>(tracks.map((t: { car: string; points: number }) => [t.car, t.points]));

    for (const g of groups) {
      const sample: string[] = g.sample ?? [];
      const missingInSample = await this.countMissing(sample);
      // 用抽樣的缺件率推估全體：抽 50 張缺 5 張，就估總數的一成
      const missing = sample.length ? Math.round((missingInSample / sample.length) * g.imageTotal) : 0;

      const points = trackByCar.get(g.car) ?? 0;
      const note = this.composeNote(g.caseCount, points, missing);

      await this.dataSource.query(
        `
        INSERT INTO daily_checks
               (company_id, check_date, project_id, car, county, district,
                case_count, image_total, image_missing, track_points, first_at, last_at, uploaded, note, checked_at)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, now())
        ON CONFLICT (company_id, check_date, project_id, car, district)
        DO UPDATE SET case_count    = EXCLUDED.case_count,
                      image_total   = EXCLUDED.image_total,
                      image_missing = EXCLUDED.image_missing,
                      track_points  = EXCLUDED.track_points,
                      first_at      = EXCLUDED.first_at,
                      last_at       = EXCLUDED.last_at,
                      note          = EXCLUDED.note,
                      checked_at    = now()
        `,
        [
          companyId,
          date,
          g.projectId,
          g.car,
          g.county,
          g.district,
          g.caseCount,
          g.imageTotal,
          missing,
          points,
          g.firstAt,
          g.lastAt,
          note
        ]
      );
    }

    return { rows: groups.length, date };
  }

  /**
   * 抽驗照片是否真的存在。
   *
   * 物件儲存不可用時回 0 而不是把整個檢查算失敗 ——
   * 「照片可能缺件」是提示，「昨天各車上傳了幾筆」才是這張表的主要用途。
   */
  private async countMissing(keys: string[]): Promise<number> {
    if (!keys.length) return 0;

    try {
      const results = await Promise.all(keys.map((key) => this.storageService.exists(key)));
      return results.filter((exists) => !exists).length;
    } catch (error: any) {
      this.logger.warn(`照片抽驗失敗，本次不計缺件：${error?.message}`);
      return 0;
    }
  }

  /** 檢查結論：這一行是督導唯一會讀的東西 */
  private composeNote(caseCount: number, trackPoints: number, missing: number): string {
    if (!caseCount && !trackPoints) return '未出車';
    if (!caseCount) return '有軌跡但沒有案件，請確認判讀模型是否正常';
    if (missing) return `照片可能缺件約 ${missing} 張`;

    return '正常';
  }
}
