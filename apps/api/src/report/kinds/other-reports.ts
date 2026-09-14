import { MAINTAIN_LEVEL_DEF, SIFT_PAY_DEFAULT, SURVEY_METHOD_DEF, CRACK_TYPE_DEF, DEGREE_DEF } from '@road-patrol/shared';
import type { ReportData } from '../report.type';
import { ROW_LIMIT, monthRange, num, periodText, str, type ReportQuery } from './shared';

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(MAINTAIN_LEVEL_DEF.map((l) => [l.key, l.name]));
const METHOD_LABEL: Record<string, string> = Object.fromEntries(SURVEY_METHOD_DEF.map((m) => [m.key, m.name]));
const CRACK_LABEL: Record<string, string> = Object.fromEntries(CRACK_TYPE_DEF.map((c) => [c.key, c.name]));
const DEGREE_LABEL: Record<string, string> = Object.fromEntries(DEGREE_DEF.map((d) => [d.key, d.name]));

/**
 * 道路評估路段報表。
 *
 * 決策的單位是路段：不會為了一個坑洞刨鋪整條路，
 * 但一條路上密集出現坑洞就該整段處理。所以這份報表按路段列，
 * 並且把「這一段上有幾件案件」放在旁邊 —— 分數是怎麼來的要看得見。
 */
export const roadEvalReport: ReportQuery = async (ds, companyId, params) => {
  const rows = await ds.query(
    `
    SELECT s.code                                     AS "code",
           s.road_name                                AS "roadName",
           s.section                                  AS "section",
           s.district                                 AS "district",
           s.lane_count                               AS "laneCount",
           ROUND(s.length_m::numeric, 2)::float8      AS "lengthM",
           ROUND(s.pci::numeric, 2)::float8           AS "pci",
           ROUND(s.iri::numeric, 2)::float8           AS "iri",
           s.maintain_level                           AS "level",
           s.case_count                               AS "caseCount",
           s.last_eval_at                             AS "lastEvalAt",
           (SELECT COUNT(*)::int FROM survey_cases sc
             WHERE sc.segment_id = s.id AND sc.deleted_at IS NULL AND sc.state = 'DONE') AS "surveyCount"
      FROM road_segments s
     WHERE s.company_id = $1
       AND ($2::text IS NULL OR s.district = $2)
       AND ($3::text IS NULL OR s.maintain_level = $3)
       AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = s.project_id AND p.prj_id = $4))
     ORDER BY s.pci ASC
     LIMIT ${ROW_LIMIT}
    `,
    [companyId, str(params, 'DISTRICT') ?? null, str(params, 'MAINTAIN_LEVEL') ?? null, str(params, 'PRJ_ID') ?? null]
  );

  const byLevel = new Map<string, { count: number; km: number }>();
  for (const r of rows) {
    const key = LEVEL_LABEL[r.level] ?? r.level;
    const acc = byLevel.get(key) ?? { count: 0, km: 0 };
    byLevel.set(key, { count: acc.count + 1, km: acc.km + Number(r.lengthM) / 1000 });
  }

  const needRepair = rows.filter((r: any) => ['POOR', 'CRITICAL'].includes(r.level)).length;

  return {
    title: '道路評估路段報表',
    period: `路段總數：${rows.length}`,
    sheets: [
      {
        name: '路段明細',
        summary: [
          { label: '路段總數', value: rows.length },
          { label: '需維修(不良以下)', value: needRepair },
          { label: '需維修比例', value: rows.length ? `${Math.round((needRepair / rows.length) * 100)}%` : '—' }
        ],
        columns: [
          { key: 'code', header: '路段代碼', width: 14 },
          { key: 'roadName', header: '路名', width: 16 },
          { key: 'section', header: '段' },
          { key: 'district', header: '行政區' },
          { key: 'laneCount', header: '車道數', type: 'number', digits: 0 },
          { key: 'lengthM', header: '長度(m)', type: 'number' },
          { key: 'pci', header: 'PCI', type: 'number', digits: 1 },
          { key: 'iri', header: 'IRI', type: 'number' },
          { key: 'levelName', header: '養護等級' },
          { key: 'caseCount', header: '案件數', type: 'number', digits: 0 },
          { key: 'surveyCount', header: '實測點數', type: 'number', digits: 0 },
          { key: 'lastEvalAt', header: '最後評估', type: 'datetime', width: 20 }
        ],
        rows: rows.map((r: any) => ({ ...r, levelName: LEVEL_LABEL[r.level] ?? r.level })),
        note: 'PCI 由案件密度推算；有實測點數的路段，分數已被鋪面調查的實測值覆蓋。'
      },
      {
        name: '等級分布',
        columns: [
          { key: 'level', header: '養護等級' },
          { key: 'count', header: '路段數', type: 'number', digits: 0 },
          { key: 'km', header: '長度(km)', type: 'number' }
        ],
        rows: [...byLevel.entries()].map(([level, v]) => ({ level, count: v.count, km: Number(v.km.toFixed(2)) }))
      }
    ]
  } satisfies ReportData;
};

/**
 * 二篩人員薪資表。
 *
 * 與畫面上的薪資表是同一套算法，但這裡多一張「明細」——
 * 對帳時被問「這 200 件是哪 200 件」，總表回答不了。
 */
export const siftSalaryReport: ReportQuery = async (ds, companyId, params) => {
  const month = str(params, 'MONTH') ?? new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const { unitPrice, errorPrice } = SIFT_PAY_DEFAULT;

  const summary = await ds.query(
    `
    SELECT u.id                                                                                       AS "userId",
           u.employee_no                                                                              AS "employeeNo",
           u.name                                                                                     AS "userName",
           COUNT(*)::int                                                                              AS "judged",
           COUNT(*) FILTER (WHERE st.upd_status_adm IS NOT NULL AND st.status = 4)::int               AS "overturned"
      FROM patrol_case_statuses st
      JOIN patrol_cases c ON c.id = st.case_id
      JOIN users u ON u.id = st.upd_status_usr
     WHERE c.company_id = $1 AND st.upd_status_usr_at >= $2 AND st.upd_status_usr_at < $3
       AND ($4::int IS NULL OR u.id = $4)
     GROUP BY u.id, u.employee_no, u.name
     ORDER BY "judged" DESC
    `,
    [companyId, start, end, num(params, 'USER_ID') ?? null]
  );

  const detail = await ds.query(
    `
    SELECT u.name                          AS "userName",
           c.case_num                      AS "caseNum",
           c.crack_type                    AS "crackType",
           st.status                       AS "status",
           st.upd_status_usr_at            AS "judgedAt",
           adm.name                        AS "reviewedBy",
           st.upd_status_adm_at            AS "reviewedAt"
      FROM patrol_case_statuses st
      JOIN patrol_cases c ON c.id = st.case_id
      JOIN users u ON u.id = st.upd_status_usr
      LEFT JOIN users adm ON adm.id = st.upd_status_adm
     WHERE c.company_id = $1 AND st.upd_status_usr_at >= $2 AND st.upd_status_usr_at < $3
       AND ($4::int IS NULL OR u.id = $4)
     ORDER BY u.name, st.upd_status_usr_at
     LIMIT ${ROW_LIMIT}
    `,
    [companyId, start, end, num(params, 'USER_ID') ?? null]
  );

  const rows = summary.map((r: any) => {
    const gross = r.judged * unitPrice;
    const deduction = r.overturned * errorPrice;

    return {
      ...r,
      gross: Number(gross.toFixed(2)),
      deduction: Number(deduction.toFixed(2)),
      net: Number((gross - deduction).toFixed(2)),
      accuracy: r.judged ? Math.round(((r.judged - r.overturned) / r.judged) * 100) : 100
    };
  });

  return {
    title: `${month} 二篩人員薪資表`,
    period: `結算月份：${month}　單價 ${unitPrice} / 誤判扣 ${errorPrice}`,
    sheets: [
      {
        name: '薪資總表',
        summary: [
          { label: '判定總量', value: rows.reduce((s: number, r: any) => s + r.judged, 0) },
          { label: '應付總額', value: Number(rows.reduce((s: number, r: any) => s + r.net, 0).toFixed(2)) }
        ],
        columns: [
          { key: 'employeeNo', header: '員工編號', width: 16 },
          { key: 'userName', header: '判讀員' },
          { key: 'judged', header: '判定量', type: 'number', digits: 0 },
          { key: 'overturned', header: '被推翻', type: 'number', digits: 0 },
          { key: 'accuracy', header: '準確率(%)', type: 'number', digits: 0 },
          { key: 'gross', header: '應計', type: 'number' },
          { key: 'deduction', header: '扣款', type: 'number' },
          { key: 'net', header: '應付', type: 'number' }
        ],
        rows,
        note: `扣款高於單價是刻意的：亂按通過比不按更糟 —— 錯的案件會被派工，現場的人白跑一趟。`
      },
      {
        name: '判定明細',
        columns: [
          { key: 'userName', header: '判讀員' },
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'crackTypeName', header: '破壞類型' },
          { key: 'statusName', header: '判定結果' },
          { key: 'judgedAt', header: '判定時間', type: 'datetime', width: 20 },
          { key: 'reviewedBy', header: '覆核者' },
          { key: 'reviewedAt', header: '覆核時間', type: 'datetime', width: 20 }
        ],
        rows: detail.map((r: any) => ({
          ...r,
          crackTypeName: CRACK_LABEL[r.crackType] ?? r.crackType,
          statusName: { 1: '通過', 3: '刪除', 4: '誤判' }[Number(r.status)] ?? String(r.status)
        })),
        note: '對帳時被問「這幾件是哪幾件」，總表回答不了 —— 明細是為了那個場合存在的。'
      }
    ]
  } satisfies ReportData;
};

// ═══ 鋪面調查的四種報表 ═════════════════════════════════════════

/** 共用：委託單的抬頭資訊 */
async function surveyOrderHead(ds: any, companyId: number, orderId: number) {
  const [order] = await ds.query(
    `SELECT o.id, o.order_no AS "orderNo", o.title, o.requester, o.due_date AS "dueDate", o.state,
            u.name AS "surveyor", p.prj_id AS "prjId"
       FROM survey_orders o
       LEFT JOIN users u ON u.id = o.surveyor_id
       LEFT JOIN projects p ON p.id = o.project_id
      WHERE o.id = $1 AND o.company_id = $2`,
    [orderId, companyId]
  );

  if (!order) throw new Error(`找不到委託單：${orderId}`);
  return order;
}

/**
 * 柔性鋪面狀況調查紀錄表。
 *
 * 這是要交給業主用印的那一份：一個調查點一列，欄位是規範規定的 ——
 * 樁號、車道、天氣、破壞類型與尺寸、厚度、PCI。
 * 欄位順序不能自己改，業主是照著規範在核對的。
 */
export const surveyRecordReport: ReportQuery = async (ds, companyId, params) => {
  const orderId = num(params, 'ORDER_ID');
  if (!orderId) throw new Error('缺少 ORDER_ID');

  const order = await surveyOrderHead(ds, companyId, orderId);

  const rows = await ds.query(
    `
    SELECT d.seq                                    AS "seq",
           c.case_num                               AS "caseNum",
           COALESCE(c.road_name, d.road)            AS "road",
           c.county                                 AS "county",
           c.district                               AS "district",
           c.lane                                   AS "lane",
           c.station_k                              AS "stationK",
           c.station_m                              AS "stationM",
           c.weather                                AS "weather",
           c.method                                 AS "method",
           c.dtype                                  AS "dtype",
           c.degree                                 AS "degree",
           c.dtype_length                           AS "dtypeLength",
           c.dtype_width                            AS "dtypeWidth",
           c.dtype_area                             AS "dtypeArea",
           c.dtype_qty                              AS "dtypeQty",
           ROUND(c.thickness_cm::numeric, 2)::float8 AS "thicknessCm",
           ROUND(c.pci::numeric, 2)::float8          AS "pci",
           ROUND(c.iri::numeric, 2)::float8          AS "iri",
           c.surveyed_at                            AS "surveyedAt",
           u.name                                   AS "surveyor",
           c.finding                                AS "finding"
      FROM survey_cases c
      LEFT JOIN survey_order_details d ON d.id = c.detail_id
      LEFT JOIN users u ON u.id = c.surveyor_id
     WHERE c.order_id = $1 AND c.company_id = $2 AND c.deleted_at IS NULL
     ORDER BY d.seq NULLS LAST, c.station_k, c.station_m, c.id
    `,
    [orderId, companyId]
  );

  return {
    title: '柔性鋪面狀況調查紀錄表',
    period: `${order.orderNo}　${order.title}`,
    sheets: [
      {
        name: '調查紀錄',
        summary: [
          { label: '委託單號', value: order.orderNo },
          { label: '委託單位', value: order.requester ?? '—' },
          { label: '調查人員', value: order.surveyor ?? '—' },
          { label: '調查點數', value: rows.length }
        ],
        columns: [
          { key: 'seq', header: '項次', type: 'number', digits: 0 },
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'road', header: '路段', width: 18 },
          { key: 'district', header: '行政區' },
          { key: 'lane', header: '車道', type: 'number', digits: 0 },
          { key: 'station', header: '樁號', width: 12 },
          { key: 'weather', header: '天氣' },
          { key: 'methodName', header: '調查方法' },
          { key: 'dtypeName', header: '破壞類型' },
          { key: 'degreeName', header: '程度' },
          { key: 'dtypeLength', header: '長(m)', type: 'number' },
          { key: 'dtypeWidth', header: '寬(m)', type: 'number' },
          { key: 'dtypeArea', header: '面積(m²)', type: 'number' },
          { key: 'dtypeQty', header: '數量', type: 'number', digits: 0 },
          { key: 'thicknessCm', header: '厚度(cm)', type: 'number' },
          { key: 'pci', header: 'PCI', type: 'number', digits: 1 },
          { key: 'iri', header: 'IRI', type: 'number' },
          { key: 'surveyedAt', header: '調查時間', type: 'datetime', width: 20 },
          { key: 'surveyor', header: '調查人員' },
          { key: 'finding', header: '調查發現', width: 30 }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          station: r.stationK === null ? '' : `${r.stationK}K+${String(r.stationM ?? 0).padStart(3, '0')}`,
          methodName: METHOD_LABEL[r.method] ?? r.method,
          dtypeName: r.dtype ? (CRACK_LABEL[r.dtype] ?? r.dtype) : '',
          degreeName: r.degree ? (DEGREE_LABEL[r.degree] ?? r.degree) : ''
        })),
        note: '欄位順序依規範排列 —— 業主是照著規範核對的，自行調整會被退件。'
      }
    ]
  } satisfies ReportData;
};

/**
 * 鋪面路段報表。
 *
 * 以委託明細(業主指定的路段)為單位彙總：這一段取了幾個樣、
 * 平均 PCI 多少、最差的那一點在哪裡。業主看的是路段能不能驗收，
 * 不是單一個點的數字。
 */
export const surveySegmentReport: ReportQuery = async (ds, companyId, params) => {
  const orderId = num(params, 'ORDER_ID');
  if (!orderId) throw new Error('缺少 ORDER_ID');

  const order = await surveyOrderHead(ds, companyId, orderId);

  const rows = await ds.query(
    `
    SELECT d.seq                                              AS "seq",
           d.road                                             AS "road",
           d.road_start                                       AS "roadStart",
           d.road_end                                         AS "roadEnd",
           d.station_k                                        AS "stationK",
           d.station_m                                        AS "stationM",
           d.direction                                        AS "direction",
           d.lane_count                                       AS "laneCount",
           ROUND(d.road_length_m::numeric, 2)::float8         AS "lengthM",
           ROUND(d.road_width_m::numeric, 2)::float8          AS "widthM",
           d.sample_count                                     AS "required",
           COUNT(c.id) FILTER (WHERE c.state = 'DONE')::int   AS "done",
           ROUND(AVG(c.pci)::numeric, 2)::float8              AS "avgPci",
           ROUND(MIN(c.pci)::numeric, 2)::float8              AS "minPci",
           ROUND(AVG(c.thickness_cm)::numeric, 2)::float8     AS "avgThickness"
      FROM survey_order_details d
      LEFT JOIN survey_cases c ON c.detail_id = d.id AND c.deleted_at IS NULL
     WHERE d.order_id = $1
     GROUP BY d.id
     ORDER BY d.seq
    `,
    [orderId]
  );

  return {
    title: '鋪面調查路段報表',
    period: `${order.orderNo}　${order.title}`,
    sheets: [
      {
        name: '路段彙總',
        summary: [
          { label: '委託單號', value: order.orderNo },
          { label: '路段數', value: rows.length },
          { label: '應取樣合計', value: rows.reduce((s: number, r: any) => s + r.required, 0) },
          { label: '已完成合計', value: rows.reduce((s: number, r: any) => s + r.done, 0) }
        ],
        columns: [
          { key: 'seq', header: '項次', type: 'number', digits: 0 },
          { key: 'road', header: '路段', width: 18 },
          { key: 'roadStart', header: '起點', width: 14 },
          { key: 'roadEnd', header: '迄點', width: 14 },
          { key: 'station', header: '樁號', width: 12 },
          { key: 'directionName', header: '方向' },
          { key: 'laneCount', header: '車道', type: 'number', digits: 0 },
          { key: 'lengthM', header: '長度(m)', type: 'number' },
          { key: 'widthM', header: '路寬(m)', type: 'number' },
          { key: 'required', header: '應取樣', type: 'number', digits: 0 },
          { key: 'done', header: '已完成', type: 'number', digits: 0 },
          { key: 'progress', header: '進度(%)', type: 'number', digits: 0 },
          { key: 'avgPci', header: '平均 PCI', type: 'number', digits: 1 },
          { key: 'minPci', header: '最低 PCI', type: 'number', digits: 1 },
          { key: 'avgThickness', header: '平均厚度(cm)', type: 'number' }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          station: r.stationK === null ? '' : `${r.stationK}K+${String(r.stationM ?? 0).padStart(3, '0')}`,
          directionName: { BOTH: '雙向', FORWARD: '順向', BACKWARD: '逆向' }[r.direction as string] ?? r.direction,
          progress: r.required ? Math.min(100, Math.round((r.done / r.required) * 100)) : 0
        })),
        note: '「最低 PCI」比平均值重要：一段路的驗收看的是最差的那一點。'
      }
    ]
  } satisfies ReportData;
};

/**
 * 鋪面案件清單與照片。
 *
 * 附件用的那一份：每個調查點一列，帶照片網址。
 * 照片不內嵌進 Excel —— 一份三百張照片的活頁簿會大到寄不出去，
 * 而簽名網址在有效期內點得開。
 */
export const surveyPhotoReport: ReportQuery = async (ds, companyId, params) => {
  const orderId = num(params, 'ORDER_ID');
  if (!orderId) throw new Error('缺少 ORDER_ID');

  const order = await surveyOrderHead(ds, companyId, orderId);

  const rows = await ds.query(
    `
    SELECT c.case_num                       AS "caseNum",
           COALESCE(c.road_name, d.road)    AS "road",
           c.district                       AS "district",
           c.lane                           AS "lane",
           c.station_k                      AS "stationK",
           c.station_m                      AS "stationM",
           c.source                         AS "source",
           c.photo_key                      AS "photoKey",
           c.surveyed_at                    AS "surveyedAt",
           u.name                           AS "surveyor",
           c.finding                        AS "finding"
      FROM survey_cases c
      LEFT JOIN survey_order_details d ON d.id = c.detail_id
      LEFT JOIN users u ON u.id = c.surveyor_id
     WHERE c.order_id = $1 AND c.company_id = $2 AND c.deleted_at IS NULL
     ORDER BY d.seq NULLS LAST, c.id
    `,
    [orderId, companyId]
  );

  const withPhoto = rows.filter((r: any) => r.photoKey).length;

  return {
    title: '鋪面調查案件清單與照片',
    period: `${order.orderNo}　${order.title}`,
    sheets: [
      {
        name: '案件與照片',
        summary: [
          { label: '委託單號', value: order.orderNo },
          { label: '案件數', value: rows.length },
          { label: '有照片', value: `${withPhoto} / ${rows.length}` }
        ],
        columns: [
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'road', header: '路段', width: 18 },
          { key: 'district', header: '行政區' },
          { key: 'lane', header: '車道', type: 'number', digits: 0 },
          { key: 'station', header: '樁號', width: 12 },
          { key: 'sourceName', header: '來源' },
          { key: 'surveyedAt', header: '調查時間', type: 'datetime', width: 20 },
          { key: 'surveyor', header: '調查人員' },
          { key: 'photoKey', header: '照片檔名', width: 34 },
          { key: 'finding', header: '調查發現', width: 30 }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          station: r.stationK === null ? '' : `${r.stationK}K+${String(r.stationM ?? 0).padStart(3, '0')}`,
          sourceName: { WEB: '網頁排點', APP: 'App 現場', DEVICE: '車機匯入' }[r.source as string] ?? r.source
        })),
        note: '照片不內嵌 —— 一份三百張照片的活頁簿會大到寄不出去，這裡列檔名供對照。'
      }
    ]
  } satisfies ReportData;
};

/**
 * 已刪除案件表。
 *
 * 業主一定會問「原本不是有 30 個點嗎，怎麼剩 28 個」。
 * 軟刪除存在的唯一理由就是這張表 —— 硬刪除之後它永遠是空的。
 */
export const surveyDeletedReport: ReportQuery = async (ds, companyId, params) => {
  const orderId = num(params, 'ORDER_ID');

  const rows = await ds.query(
    `
    SELECT o.order_no                       AS "orderNo",
           c.case_num                       AS "caseNum",
           COALESCE(c.road_name, d.road)    AS "road",
           c.district                       AS "district",
           c.station_k                      AS "stationK",
           c.station_m                      AS "stationM",
           c.state                          AS "state",
           c.source                         AS "source",
           c.deleted_at                     AS "deletedAt",
           du.name                          AS "deletedBy",
           (SELECT h.note FROM case_histories h
             WHERE h.case_type = 'SURVEY' AND h.case_id = c.id AND h.action = 'DELETED'
             ORDER BY h.version DESC LIMIT 1) AS "reason"
      FROM survey_cases c
      JOIN survey_orders o ON o.id = c.order_id
      LEFT JOIN survey_order_details d ON d.id = c.detail_id
      LEFT JOIN users du ON du.id = c.deleted_by
     WHERE c.company_id = $1 AND c.deleted_at IS NOT NULL
       AND ($2::int IS NULL OR c.order_id = $2)
     ORDER BY c.deleted_at DESC
     LIMIT ${ROW_LIMIT}
    `,
    [companyId, orderId ?? null]
  );

  return {
    title: '鋪面調查已刪除案件表',
    period: orderId ? `委託單 #${orderId}` : '全部委託單',
    sheets: [
      {
        name: '已刪除案件',
        summary: [{ label: '已刪除筆數', value: rows.length }],
        columns: [
          { key: 'orderNo', header: '委託單號', width: 18 },
          { key: 'caseNum', header: '案件編號', width: 18 },
          { key: 'road', header: '路段', width: 18 },
          { key: 'district', header: '行政區' },
          { key: 'station', header: '樁號', width: 12 },
          { key: 'sourceName', header: '來源' },
          { key: 'deletedAt', header: '刪除時間', type: 'datetime', width: 20 },
          { key: 'deletedBy', header: '刪除者' },
          { key: 'reason', header: '刪除原因', width: 30 }
        ],
        rows: rows.map((r: any) => ({
          ...r,
          station: r.stationK === null ? '' : `${r.stationK}K+${String(r.stationM ?? 0).padStart(3, '0')}`,
          sourceName: { WEB: '網頁排點', APP: 'App 現場', DEVICE: '車機匯入' }[r.source as string] ?? r.source
        })),
        note: '刪除原因取自案件歷程 —— 沒有理由的刪除在驗收時說不過去。'
      }
    ]
  } satisfies ReportData;
};
