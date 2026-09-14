import {
  CASE_STATUS_LABEL,
  CRACK_LABEL,
  DEGREE_LABEL,
  EDITED_LABEL,
  MAINTENANCE_LABEL,
  MAINTENANCE_TYPE_LABEL,
  MATERIAL_LABEL,
  NEED_REPAIR_LABEL,
  PROJECT_STATE_LABEL,
  SOURCE_LABEL,
  WORK_ORDER_LABEL,
  WORK_ORDER_TYPE_LABEL,
  WORK_UNIT_LABEL
} from './vocabulary';

/** 代碼表 → 下拉選項；數字代碼的 key 會被物件轉成字串，這裡轉回來 */
export const opts = (map, numeric = false) =>
  Object.entries(map).map(([value, label]) => ({ value: numeric ? Number(value) : value, label }));

/**
 * 查詢欄位定義。
 *
 * 集中在這裡而不是寫在各畫面裡：同一組案件條件同時出現在案件列表與地圖的破壞查詢面板，
 * 兩邊各寫一份的話，地圖上查得到的案件在列表查不到 —— 而使用者只會說「系統怪怪的」。
 *
 * 常用的留在外面，其餘標 advanced 收進「更多條件」：
 * 承辦八成的時間只用日期與狀態，十幾個條件全部攤開只會讓人找不到。
 */
export function caseQueryFields({ projects = [], districts = [], sections = [], cars = [], forMap = false } = {}) {
  // 圖台與列表的「常用條件」不同：
  //   圖台是空間視角 —— 先框出範圍(縣市/標案/工務段/行政區/車輛)再看點位
  //   列表是案件視角 —— 先看狀態與類型
  // 其餘條件一律收進進階，兩邊的完整條件集是同一份
  const primary = forMap
    ? ['START_DATE', 'END_DATE', 'COUNTY', 'PRJ_ID', 'SECTION_ID', 'DISTRICT', 'CAR']
    : ['KEYWORD', 'NEED_REPAIR', 'CRACK_TYPE', 'START_DATE', 'END_DATE'];

  const fields = [
    { key: 'KEYWORD', label: '關鍵字', placeholder: '路名 / 地址 / 備註 / 編號', width: 200 },
    { key: 'NEED_REPAIR', label: '案件狀態', type: 'multi', options: opts(NEED_REPAIR_LABEL, true) },
    { key: 'CRACK_TYPE', label: '破壞類型', type: 'multi', options: opts(CRACK_LABEL) },
    { key: 'START_DATE', label: '檢測起', type: 'date' },
    { key: 'END_DATE', label: '檢測迄', type: 'date' },
    { key: 'COUNTY', label: '縣市', width: 120 },
    {
      key: 'PRJ_ID',
      label: '標案',
      type: 'multi',
      options: projects.map((p) => ({ value: p.PRJ_ID, label: `${p.PRJ_ID} ${p.PRJ_NAME}` })),
      width: 200
    },
    {
      key: 'SECTION_ID',
      label: '工務段',
      type: 'multi',
      options: sections.map((s) => ({ value: s.ID, label: s.NAME }))
    },
    {
      key: 'DISTRICT',
      label: '行政區',
      type: 'multi',
      options: districts.map((d) => ({ value: d.DISTRICT, label: d.DISTRICT }))
    },
    {
      key: 'CAR',
      label: '車輛',
      type: cars.length ? 'select' : 'text',
      options: cars.map((c) => ({ value: c.PLATE_NO, label: c.PLATE_NO })),
      width: 140
    },

    { key: 'STATUS', label: '二篩狀態', type: 'multi', options: opts(CASE_STATUS_LABEL, true) },
    { key: 'DEGREE', label: '破壞程度', type: 'multi', options: opts(DEGREE_LABEL) },
    { key: 'EDITED', label: '人工編輯', type: 'multi', options: opts(EDITED_LABEL, true) },
    { key: 'SOURCE', label: '案件來源', type: 'multi', options: opts(SOURCE_LABEL) },
    { key: 'CASE_NUM', label: '案件編號' },
    { key: 'EXTERNAL_ID', label: '原始編號' },
    { key: 'CAVLGE', label: '里別', width: 120 },
    { key: 'ROAD', label: '路名' },
    { key: 'ADDRESS', label: '地址', width: 200 },
    { key: 'AREA_MIN', label: '面積下限 m²', type: 'number', width: 120 },
    { key: 'AREA_MAX', label: '面積上限 m²', type: 'number', width: 120 },
    { key: 'DEPTH_MIN', label: '深度下限 cm', type: 'number', width: 120 },
    {
      key: 'UNDISPATCHED',
      label: '派工狀態',
      type: 'select',
      options: [{ value: 'true', label: '只看未派工' }]
    },
    {
      key: 'HAS_IMAGE',
      label: '照片',
      type: 'select',
      options: [
        { value: 'true', label: '有照片' },
        { value: 'false', label: '無照片' }
      ]
    }
  ];

  return fields.map((f) => ({ ...f, advanced: !primary.includes(f.key) }));
}

/** 軌跡查詢：與破壞查詢同一組空間條件，另加路線代碼 */
export function trackQueryFields({ projects = [], districts = [], sections = [], cars = [] } = {}) {
  const base = caseQueryFields({ projects, districts, sections, cars, forMap: true }).filter((f) =>
    ['START_DATE', 'END_DATE', 'COUNTY', 'PRJ_ID', 'SECTION_ID', 'DISTRICT', 'CAR'].includes(f.key)
  );

  return [...base, { key: 'ROUTE_KEY', label: '路線代碼', advanced: true, width: 140 }];
}

/** 道路評估：條件是「哪一段路」而不是「哪一個點」，所以有路段代碼與地址 */
export function roadEvalQueryFields({ projects = [], districts = [], sections = [] } = {}) {
  const base = caseQueryFields({ projects, districts, sections, forMap: true }).filter((f) =>
    ['START_DATE', 'END_DATE', 'COUNTY', 'PRJ_ID', 'SECTION_ID', 'DISTRICT'].includes(f.key)
  );

  return [
    ...base,
    { key: 'ROAD_NAME', label: '路名', width: 150 },
    { key: 'CODE', label: '路段代碼', advanced: true, width: 140 },
    { key: 'ADDRESS', label: '地址', advanced: true, width: 200 }
  ];
}

/** 車隊監控：不看時間，只看「現在哪些車在哪一區」 */
export function fleetQueryFields({ projects = [], districts = [], sections = [], cars = [] } = {}) {
  return caseQueryFields({ projects, districts, sections, cars, forMap: true }).filter((f) =>
    ['COUNTY', 'PRJ_ID', 'SECTION_ID', 'DISTRICT', 'CAR'].includes(f.key)
  );
}

/** 派工單查詢條件 */
export function workOrderQueryFields({ projects = [], workers = [], districts = [] } = {}) {
  return [
    { key: 'KEYWORD', label: '關鍵字', placeholder: '單號 / 地址 / 備註', width: 200 },
    { key: 'STATUS', label: '狀態', type: 'multi', options: opts(WORK_ORDER_LABEL, true) },
    { key: 'TYPE', label: '類型', type: 'multi', options: opts(WORK_ORDER_TYPE_LABEL) },
    { key: 'START_DATE', label: '派工起', type: 'date' },
    { key: 'END_DATE', label: '派工迄', type: 'date' },

    {
      key: 'PRJ_ID',
      label: '標案',
      type: 'multi',
      options: projects.map((p) => ({ value: p.PRJ_ID, label: `${p.PRJ_ID} ${p.PRJ_NAME}` })),
      advanced: true,
      width: 200
    },
    { key: 'CASE_NUM', label: '派工單號', advanced: true },
    {
      key: 'WORKER_USER_ID',
      label: '施工人員',
      type: 'select',
      options: workers.map((w) => ({ value: w.ID, label: w.NAME })),
      advanced: true
    },
    { key: 'COUNTY', label: '縣市', advanced: true, width: 120 },
    {
      key: 'DISTRICT',
      label: '行政區',
      type: 'multi',
      options: districts.map((d) => ({ value: d.DISTRICT, label: d.DISTRICT })),
      advanced: true
    },
    { key: 'CAVLGE', label: '里', advanced: true, width: 120 },
    { key: 'ADDRESS', label: '地址', advanced: true, width: 200 },
    { key: 'MATERIAL', label: '施工材料', type: 'multi', options: opts(MATERIAL_LABEL), advanced: true },
    { key: 'WORK_UNIT', label: '施工單位', type: 'multi', options: opts(WORK_UNIT_LABEL), advanced: true },
    { key: 'DUE_FROM', label: '限期起', type: 'date', advanced: true },
    { key: 'DUE_TO', label: '限期迄', type: 'date', advanced: true },
    // 驗收前最常用的兩個篩選：逾期未完工、缺必要照片
    {
      key: 'OVERDUE',
      label: '逾期',
      type: 'select',
      options: [{ value: 'true', label: '只看逾期未完工' }],
      advanced: true
    },
    {
      key: 'MISSING_IMAGE',
      label: '照片缺件',
      type: 'select',
      options: [{ value: 'true', label: '只看缺必要照片' }],
      advanced: true
    }
  ];
}

/**
 * 巡查單查詢條件。
 *
 * 與派工單分開一份而不是共用：兩者只有關鍵字與行政區重疊，
 * 硬要共用的話會出現「派工單可以用調查時段篩選」這種選項。
 */
export function maintenanceQueryFields({ projects = [], districts = [], inspectors = [] } = {}) {
  return [
    { key: 'KEYWORD', label: '關鍵字', placeholder: '單號 / 地址 / 備註', width: 200 },
    { key: 'STATUS', label: '狀態', type: 'multi', options: opts(MAINTENANCE_LABEL, true) },
    { key: 'TYPE', label: '類型', type: 'multi', options: opts(MAINTENANCE_TYPE_LABEL) },
    { key: 'START_DATE', label: '調查起', type: 'date' },
    { key: 'END_DATE', label: '調查迄', type: 'date' },
    // 待派工清單：巡查單列表最常用的一個篩選
    { key: 'NO_ORDER', label: '派工', type: 'select', options: [{ value: 'true', label: '只看未派工' }] },

    { key: 'DTYPE', label: '破壞類型', type: 'multi', options: opts(CRACK_LABEL), advanced: true },
    { key: 'DEGREE', label: '破壞程度', type: 'multi', options: opts(DEGREE_LABEL), advanced: true },
    {
      key: 'PRJ_ID',
      label: '標案',
      type: 'multi',
      options: projects.map((p) => ({ value: p.PRJ_ID, label: `${p.PRJ_ID} ${p.PRJ_NAME}` })),
      advanced: true,
      width: 200
    },
    { key: 'CASE_NUM', label: '巡查單號', advanced: true },
    {
      key: 'SURVEY_USER_ID',
      label: '調查人員',
      type: 'select',
      options: inspectors.map((w) => ({ value: w.ID, label: w.NAME })),
      advanced: true
    },
    {
      key: 'DISTRICT',
      label: '行政區',
      type: 'multi',
      options: districts.map((d) => ({ value: d.DISTRICT, label: d.DISTRICT })),
      advanced: true
    },
    { key: 'CAVLGE', label: '里', advanced: true, width: 120 }
  ];
}

/**
 * 二篩查詢條件。
 *
 * 與案件查詢共用空間條件，但**沒有狀態欄位** —— 二篩的狀態範圍由分頁決定
 * (判讀看未審、覆核看已判)，讓使用者自己選狀態會讓「判讀作業」這個分頁
 * 出現已經判完的案件，而那正是它要排除的。
 */
export function siftQueryFields({ projects = [], districts = [], cars = [] } = {}) {
  return [
    { key: 'START_DATE', label: '檢測起', type: 'date' },
    { key: 'END_DATE', label: '檢測迄', type: 'date' },
    {
      key: 'CRACK_TYPE',
      label: '破壞類型',
      type: 'multi',
      options: Object.entries(CRACK_LABEL).map(([value, label]) => ({ value, label }))
    },
    { key: 'COUNTY', label: '縣市', width: 120, advanced: true },
    {
      key: 'DISTRICT',
      label: '行政區',
      type: 'multi',
      options: districts.map((d) => ({ value: d.DISTRICT, label: d.DISTRICT })),
      advanced: true
    },
    {
      key: 'PRJ_ID',
      label: '標案',
      type: 'multi',
      options: projects.map((p) => ({ value: p.PRJ_ID, label: `${p.PRJ_ID} ${p.PRJ_NAME}` })),
      advanced: true,
      width: 200
    },
    {
      key: 'CAR',
      label: '車輛',
      type: cars.length ? 'select' : 'text',
      options: cars.map((c) => ({ value: c.PLATE_NO, label: c.PLATE_NO })),
      advanced: true,
      width: 140
    },
    {
      key: 'DEGREE',
      label: '破壞程度',
      type: 'multi',
      options: Object.entries(DEGREE_LABEL).map(([value, label]) => ({ value, label })),
      advanced: true
    }
  ];
}

/** 標案查詢條件 */
export function projectQueryFields() {
  return [
    { key: 'PRJ_ID', label: '標案號', width: 130 },
    { key: 'KEYWORD', label: '關鍵字', placeholder: '標案名稱 / 業主', width: 200 },
    { key: 'STATE', label: '狀態', type: 'multi', options: opts(PROJECT_STATE_LABEL) },
    { key: 'CURRENT', label: '執行期間', type: 'select', options: [{ value: 'true', label: '只看執行中' }] },
    {
      key: 'PROPRIETOR_LEVEL',
      label: '業主等級',
      type: 'multi',
      options: [
        { value: 1, label: '中央' },
        { value: 2, label: '直轄市' },
        { value: 3, label: '縣市' },
        { value: 4, label: '鄉鎮' }
      ],
      advanced: true
    },
    { key: 'DATE_FROM', label: '期間起', type: 'date', advanced: true },
    { key: 'DATE_TO', label: '期間迄', type: 'date', advanced: true }
  ];
}

/**
 * 查詢條件轉成查詢字串參數。
 *
 * 陣列要攤成逗號字串(查詢字串沒有陣列型別)，空值要拿掉 ——
 * 送出 `STATUS=` 這種空參數，後端的驗證會把它當成「有給但不合法」而擋下來。
 */
export function toQueryParams(form) {
  const params = {};

  for (const [key, value] of Object.entries(form ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      params[key] = value.join(',');
      continue;
    }

    params[key] = value;
  }

  return params;
}
