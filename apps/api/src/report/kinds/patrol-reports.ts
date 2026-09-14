import { CRACK_TYPE_DEF, CASE_STATUS_DEF, DEGREE_DEF, NEED_REPAIR_DEF } from '@road-patrol/shared';
import type { ReportData } from '../report.type';
import { ROW_LIMIT, dayRange, monthRange, num, periodText, str, type ReportQuery } from './shared';

// 標籤一律取自共用的代碼表定義：報表跟畫面若各寫一份，兩邊遲早會不一致，
// 而報表是要發文出去的那一份
const CRACK_LABEL: Record<string, string> = Object.fromEntries(CRACK_TYPE_DEF.map((c) => [c.key, c.name]));
const DEGREE_LABEL: Record<string, string> = Object.fromEntries(DEGREE_DEF.map((d) => [d.key, d.name]));
const STATUS_LABEL: Record<number, string> = Object.fromEntries(CASE_STATUS_DEF.map((s) => [s.value, s.name]));
const NEED_REPAIR_LABEL: Record<number, string> = Object.fromEntries(NEED_REPAIR_DEF.map((s) => [s.value, s.name]));

/**
 * 車巡案件清單。
 *
 * 最通用的一份：條件全部可選，明細加統計兩張表。
 * 其他報表都是它的特化 —— 固定了期間、固定了分組、固定了欄位。
 */
export const caseListReport: ReportQuery = async (ds, companyId, params) => {
  const { start, end } = dayRange(str(params, 'DATE_FROM'), str(params, 'DATE_TO'));

  const rows = await ds.query(
    `
    SELECT c.case_num                       AS "caseNum",
           c.external_id                    AS "externalId",
           p.prj_id                         AS "prjId",
           c.crack_type                     AS "crackType",
           c.degree                         AS "degree",
           COALESCE(st.status, 0)           AS "status",
           COALESCE(st.need_repair, 0)      AS "needRepair",
           ad.county                        AS "county",
           ad.district                      AS "district",
           ad.road                          AS "road",
           ad.address                       AS "address",
           c.length                         AS "length",
           c.width                          AS "width",
           c.area                           AS "area",
           c.depth                          AS "depth",
           c.longitude                      AS "lng",
           c.latitude                       AS "lat",
           c.car                            AS "car",
           c.dt_record                      AS "dtRecord",
           u.name                           AS "reporter"
      FROM patrol_cases c
      LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
      LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN users u ON u.id = c.reporter_id
     WHERE c.company_id = $1
       AND ($2::timestamptz IS NULL OR c.dt_record >= $2)
       AND ($3::timestamptz IS NULL OR c.dt_record < $3)
       AND ($4::text IS NULL OR p.prj_id = $4)
       AND ($5::text IS NULL OR ad.district = $5)
       AND ($6::text IS NULL OR c.crack_type = $6)
       AND ($7::int IS NULL OR COALESCE(st.status, 0) = $7)
       AND ($8::int IS NULL OR COALESCE(st.need_repair, 0) = $8)
     ORDER BY c.dt_record DESC
     LIMIT ${ROW_LIMIT}
    `,
    [
      companyId,
      start ?? null,
      end ?? null,
      str(params, 'PRJ_ID') ?? null,
      str(params, 'DISTRICT') ?? null,
      str(params, 'CRACK_TYPE') ?? null,
      num(params, 'STATUS') ?? null,
      num(params, 'NEED_REPAIR') ?? null
    ]
  );

  const byType = new Map<string, { count: number; area: number }>();
  for (const r of rows) {
    const key = CRACK_LABEL[r.crackType] ?? r.crackType;
    const acc = byType.get(key) ?? { count: 0, area: 0 };
    byType.set(key, { count: acc.count + 1, area: acc.area + Number(r.area) });
  }

  return {
    title: '道路巡查案件彙整報告',
    period: periodText(str(params, 'DATE_FROM'), str(params, 'DATE_TO')),
    sheets: [
      {
        name: '案件明細',
        summary: [
          { label: '案件總數', value: rows.length },
          { label: '破壞面積合計(m²)', value: Number(rows.reduce((s: number, r: any) => s + Number(r.area), 0).toFixed(2)) }
        ],
        columns: [
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'externalId', header: '原始編號', width: 22 },
          { key: 'prjId', header: '標案' },
          { key: 'crackTypeName', header: '破壞類型' },
          { key: 'degreeName', header: '程度' },
          { key: 'statusName', header: '二篩狀態' },
          { key: 'needRepairName', header: '修繕狀態' },
          { key: 'county', header: '縣市' },
          { key: 'district', header: '行政區' },
          { key: 'road', header: '路名', width: 18 },
          { key: 'address', header: '地址', width: 26 },
          { key: 'length', header: '長度(m)', type: 'number' },
          { key: 'width', header: '寬度(m)', type: 'number' },
          { key: 'area', header: '面積(m²)', type: 'number' },
          { key: 'depth', header: '深度(cm)', type: 'number', digits: 1 },
          { key: 'lng', header: '經度', type: 'number', digits: 6 },
          { key: 'lat', header: '緯度', type: 'number', digits: 6 },
          { key: 'car', header: '車牌' },
          { key: 'dtRecord', header: '發現時間', type: 'datetime', width: 20 },
          { key: 'reporter', header: '回報人' }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          crackTypeName: CRACK_LABEL[r.crackType] ?? r.crackType,
          degreeName: DEGREE_LABEL[r.degree] ?? r.degree,
          statusName: STATUS_LABEL[Number(r.status)] ?? r.status,
          needRepairName: NEED_REPAIR_LABEL[Number(r.needRepair)] ?? r.needRepair
        }))
      },
      {
        name: '類型統計',
        columns: [
          { key: 'type', header: '破壞類型', width: 18 },
          { key: 'count', header: '件數', type: 'number', digits: 0 },
          { key: 'area', header: '面積合計(m²)', type: 'number' }
        ],
        rows: [...byType.entries()]
          .map(([type, v]) => ({ type, count: v.count, area: Number(v.area.toFixed(2)) }))
          .sort((a, b) => b.count - a.count)
      }
    ]
  } satisfies ReportData;
};

/**
 * 每日巡查報表。
 *
 * 督導早上看的那一份：昨天各車跑了多少、發現多少、還有多少沒判。
 * 與案件清單的差別是**分組維度固定為「車輛 × 日期」** ——
 * 督導要問的是「哪一台車昨天沒出門」，不是「有哪些坑洞」。
 */
export const dailyReport: ReportQuery = async (ds, companyId, params) => {
  const day = str(params, 'DAY') ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start.getTime() + 86400000);

  const rows = await ds.query(
    `
    SELECT COALESCE(c.car, '未指定')                                       AS "car",
           COALESCE(p.prj_id, '未歸屬')                                    AS "prjId",
           COUNT(*)::int                                                   AS "total",
           COUNT(*) FILTER (WHERE COALESCE(st.status, 0) = 0)::int         AS "unjudged",
           COUNT(*) FILTER (WHERE st.status = 1)::int                      AS "passed",
           COUNT(*) FILTER (WHERE st.need_repair = 2)::int                 AS "dispatched",
           ROUND(SUM(c.area)::numeric, 2)::float8                          AS "area",
           MIN(c.dt_record)                                                AS "firstAt",
           MAX(c.dt_record)                                                AS "lastAt"
      FROM patrol_cases c
      LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
      LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.company_id = $1 AND c.dt_record >= $2 AND c.dt_record < $3
       AND ($4::text IS NULL OR p.prj_id = $4)
     GROUP BY c.car, p.prj_id
     ORDER BY "total" DESC
    `,
    [companyId, start, end, str(params, 'PRJ_ID') ?? null]
  );

  const mileage = await ds.query(
    `
    SELECT v.plate_no                                                                                   AS "car",
           ROUND((ST_Length(ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at)::geography) / 1000)::numeric, 2)::float8 AS "km",
           COUNT(*)::int                                                                                AS "points"
      FROM vehicle_tracks t
      JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.company_id = $1 AND t.recorded_at >= $2 AND t.recorded_at < $3
     GROUP BY v.plate_no
     ORDER BY "km" DESC
    `,
    [companyId, start, end]
  );

  return {
    title: '每日巡查報表',
    period: `統計日期：${day}`,
    sheets: [
      {
        name: '各車發現統計',
        summary: [
          { label: '當日案件總數', value: rows.reduce((s: number, r: any) => s + r.total, 0) },
          { label: '出勤車輛數', value: rows.length }
        ],
        columns: [
          { key: 'car', header: '車牌' },
          { key: 'prjId', header: '標案' },
          { key: 'total', header: '發現件數', type: 'number', digits: 0 },
          { key: 'unjudged', header: '未判讀', type: 'number', digits: 0 },
          { key: 'passed', header: '二篩通過', type: 'number', digits: 0 },
          { key: 'dispatched', header: '已派工', type: 'number', digits: 0 },
          { key: 'area', header: '面積合計(m²)', type: 'number' },
          { key: 'firstAt', header: '首筆時間', type: 'datetime', width: 20 },
          { key: 'lastAt', header: '末筆時間', type: 'datetime', width: 20 }
        ],
        rows,
        note: '「未判讀」是當天需要二篩人員處理的量；連續幾天不為零表示判讀人力不足。'
      },
      {
        name: '各車里程',
        columns: [
          { key: 'car', header: '車牌' },
          { key: 'km', header: '里程(km)', type: 'number' },
          { key: 'points', header: '軌跡點數', type: 'number', digits: 0 }
        ],
        rows: mileage,
        note: '里程由 PostGIS 依軌跡點連線計算，不是車機回報的儀表數字。'
      }
    ]
  } satisfies ReportData;
};

/**
 * 月報表。
 *
 * 請款用的那一份：一個月內每一天的量、以及行政區的分布。
 * 日期用 `generate_series` 補齊 —— 沒有案件的那天要顯示 0 而不是消失，
 * 否則業主會問「7 號的資料呢」。
 */
export const monthlyReport: ReportQuery = async (ds, companyId, params) => {
  const month = str(params, 'MONTH') ?? new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);

  const daily = await ds.query(
    `
    SELECT to_char(d.day, 'YYYY-MM-DD')                                  AS "day",
           COUNT(c.id)::int                                              AS "total",
           COUNT(c.id) FILTER (WHERE st.need_repair = 2)::int            AS "dispatched",
           COUNT(w.id) FILTER (WHERE ws.status = 3)::int                 AS "finished",
           COALESCE(ROUND(SUM(c.area)::numeric, 2), 0)::float8           AS "area"
      FROM generate_series($2::timestamptz, $3::timestamptz - interval '1 day', interval '1 day') AS d(day)
      LEFT JOIN patrol_cases c
             ON c.company_id = $1 AND c.dt_record >= d.day AND c.dt_record < d.day + interval '1 day'
      LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
      LEFT JOIN work_orders w ON w.case_patrol_id = c.id
      LEFT JOIN work_order_statuses ws ON ws.work_order_id = w.id
     GROUP BY d.day
     ORDER BY d.day
    `,
    [companyId, start, end]
  );

  const byDistrict = await ds.query(
    `
    SELECT COALESCE(ad.district, '未定位')                        AS "district",
           COUNT(*)::int                                          AS "total",
           COUNT(*) FILTER (WHERE st.need_repair = 2)::int        AS "dispatched",
           ROUND(SUM(c.area)::numeric, 2)::float8                 AS "area"
      FROM patrol_cases c
      LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
      LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
     WHERE c.company_id = $1 AND c.dt_record >= $2 AND c.dt_record < $3
     GROUP BY ad.district
     ORDER BY "total" DESC
    `,
    [companyId, start, end]
  );

  const total = daily.reduce((s: number, r: any) => s + r.total, 0);

  return {
    title: `${month} 道路巡查月報表`,
    period: `統計期間：${month}`,
    sheets: [
      {
        name: '每日統計',
        summary: [
          { label: '當月案件總數', value: total },
          { label: '已派工', value: daily.reduce((s: number, r: any) => s + r.dispatched, 0) },
          { label: '已完工', value: daily.reduce((s: number, r: any) => s + r.finished, 0) }
        ],
        columns: [
          { key: 'day', header: '日期', width: 12 },
          { key: 'total', header: '發現件數', type: 'number', digits: 0 },
          { key: 'dispatched', header: '已派工', type: 'number', digits: 0 },
          { key: 'finished', header: '已完工', type: 'number', digits: 0 },
          { key: 'area', header: '面積(m²)', type: 'number' }
        ],
        rows: daily,
        note: '沒有案件的日期一樣列出並顯示 0 —— 空白會被誤讀成「資料漏了」。'
      },
      {
        name: '行政區分布',
        columns: [
          { key: 'district', header: '行政區' },
          { key: 'total', header: '件數', type: 'number', digits: 0 },
          { key: 'dispatched', header: '已派工', type: 'number', digits: 0 },
          { key: 'area', header: '面積(m²)', type: 'number' }
        ],
        rows: byDistrict
      }
    ]
  } satisfies ReportData;
};

/**
 * 坑洞報表。
 *
 * 養護單位排工用：只看坑洞，而且要看得出「修了沒有」。
 * 坑洞是唯一有獨立編號的破壞類型 —— 業主會用那個編號來追。
 */
export const potholeReport: ReportQuery = async (ds, companyId, params) => {
  const { start, end } = dayRange(str(params, 'DATE_FROM'), str(params, 'DATE_TO'));

  const rows = await ds.query(
    `
    SELECT c.case_num                                   AS "caseNum",
           ad.district                                  AS "district",
           ad.road                                      AS "road",
           ad.address                                   AS "address",
           c.length                                     AS "length",
           c.width                                      AS "width",
           c.area                                       AS "area",
           c.depth                                      AS "depth",
           c.longitude                                  AS "lng",
           c.latitude                                   AS "lat",
           c.dt_record                                  AS "dtRecord",
           w.case_num                                   AS "orderNo",
           ws.status                                    AS "orderStatus",
           w.work_end_date                              AS "finishedAt"
      FROM patrol_cases c
      LEFT JOIN patrol_case_statuses st ON st.case_id = c.id
      LEFT JOIN patrol_case_addresses ad ON ad.case_id = c.id
      LEFT JOIN work_orders w ON w.case_patrol_id = c.id
      LEFT JOIN work_order_statuses ws ON ws.work_order_id = w.id
     WHERE c.company_id = $1
       AND c.crack_type = 'Potholes'
       AND ($2::timestamptz IS NULL OR c.dt_record >= $2)
       AND ($3::timestamptz IS NULL OR c.dt_record < $3)
       AND ($4::text IS NULL OR ad.district = $4)
       AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = c.project_id AND p.prj_id = $5))
     ORDER BY c.dt_record DESC
     LIMIT ${ROW_LIMIT}
    `,
    [companyId, start ?? null, end ?? null, str(params, 'DISTRICT') ?? null, str(params, 'PRJ_ID') ?? null]
  );

  const finished = rows.filter((r: any) => r.orderStatus === 3).length;
  const undispatched = rows.filter((r: any) => !r.orderNo).length;

  return {
    title: '坑洞案件報表',
    period: periodText(str(params, 'DATE_FROM'), str(params, 'DATE_TO')),
    sheets: [
      {
        name: '坑洞明細',
        summary: [
          { label: '坑洞總數', value: rows.length },
          { label: '已完修', value: finished },
          { label: '尚未派工', value: undispatched },
          { label: '完修率', value: rows.length ? `${Math.round((finished / rows.length) * 100)}%` : '—' }
        ],
        columns: [
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'district', header: '行政區' },
          { key: 'road', header: '路名', width: 18 },
          { key: 'address', header: '地址', width: 24 },
          { key: 'length', header: '長(m)', type: 'number' },
          { key: 'width', header: '寬(m)', type: 'number' },
          { key: 'area', header: '面積(m²)', type: 'number' },
          { key: 'depth', header: '深度(cm)', type: 'number', digits: 1 },
          { key: 'lng', header: '經度', type: 'number', digits: 6 },
          { key: 'lat', header: '緯度', type: 'number', digits: 6 },
          { key: 'dtRecord', header: '發現時間', type: 'datetime', width: 20 },
          { key: 'orderNo', header: '派工單號', width: 18 },
          { key: 'orderStatusName', header: '施工狀態' },
          { key: 'finishedAt', header: '完工日', type: 'date' }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          orderStatusName: r.orderNo ? (['已刪除', '待處理', '施工中', '已回報', '已完工'][r.orderStatus + 1] ?? '') : '未派工'
        })),
        note: '深度決定工法：超過 5 公分通常要刨除重鋪，淺的可以冷料填補。'
      }
    ]
  } satisfies ReportData;
};

/**
 * 巡查軌跡報表。
 *
 * 履約檢核用：每台車每天跑了多遠、幾點出門幾點收工。
 * 里程由 PostGIS 算 —— 車機回報的儀表數字包含非巡查路段(例如回廠)。
 */
export const trackReport: ReportQuery = async (ds, companyId, params) => {
  const { start, end } = dayRange(str(params, 'DATE_FROM'), str(params, 'DATE_TO'));

  const rows = await ds.query(
    `
    SELECT v.plate_no                                                                                    AS "car",
           v.name                                                                                        AS "vehicleName",
           to_char(date_trunc('day', t.recorded_at), 'YYYY-MM-DD')                                       AS "day",
           COUNT(*)::int                                                                                 AS "points",
           ROUND((ST_Length(ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at)::geography) / 1000)::numeric, 2)::float8 AS "km",
           ROUND(MAX(t.speed_kph)::numeric, 1)::float8                                                   AS "maxSpeed",
           ROUND(AVG(NULLIF(t.speed_kph, 0))::numeric, 1)::float8                                        AS "avgSpeed",
           MIN(t.recorded_at)                                                                            AS "startAt",
           MAX(t.recorded_at)                                                                            AS "endAt"
      FROM vehicle_tracks t
      JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.company_id = $1
       AND ($2::timestamptz IS NULL OR t.recorded_at >= $2)
       AND ($3::timestamptz IS NULL OR t.recorded_at < $3)
       AND ($4::int IS NULL OR t.vehicle_id = $4)
     GROUP BY v.plate_no, v.name, date_trunc('day', t.recorded_at)
     ORDER BY "day" DESC, "car"
     LIMIT ${ROW_LIMIT}
    `,
    [companyId, start ?? null, end ?? null, num(params, 'VEHICLE_ID') ?? null]
  );

  return {
    title: '巡查軌跡報表',
    period: periodText(str(params, 'DATE_FROM'), str(params, 'DATE_TO')),
    sheets: [
      {
        name: '每日軌跡',
        summary: [
          { label: '總里程(km)', value: Number(rows.reduce((s: number, r: any) => s + Number(r.km), 0).toFixed(2)) },
          { label: '出勤天數合計', value: rows.length }
        ],
        columns: [
          { key: 'day', header: '日期', width: 12 },
          { key: 'car', header: '車牌' },
          { key: 'vehicleName', header: '車輛名稱' },
          { key: 'km', header: '里程(km)', type: 'number' },
          { key: 'points', header: '軌跡點數', type: 'number', digits: 0 },
          { key: 'maxSpeed', header: '最高時速', type: 'number', digits: 1 },
          { key: 'avgSpeed', header: '平均時速', type: 'number', digits: 1 },
          { key: 'startAt', header: '首筆', type: 'datetime', width: 20 },
          { key: 'endAt', header: '末筆', type: 'datetime', width: 20 }
        ],
        rows,
        note: '里程由軌跡點連線計算，不含車機回報的非巡查路段。'
      }
    ]
  } satisfies ReportData;
};
