import {
  BUILDING_USAGE_DEF,
  COMMAND_ACTION_DEF,
  CASE_SOURCE_DEF,
  CASE_STATUS_DEF,
  CASE_EDITED_DEF,
  CRACK_TYPE_DEF,
  DEGREE_DEF,
  MAINTAIN_LEVEL_DEF,
  MAINTENANCE_STATUS_DEF,
  MAINTENANCE_TYPE_DEF,
  MATERIAL_DEF,
  NEED_REPAIR_DEF,
  PROJECT_STATE_DEF,
  STREAM_STATE_DEF,
  REGION_LEVEL_DEF,
  SURVEY_METHOD_DEF,
  SURVEY_ORDER_STATE_DEF,
  SURVEY_STATUS_DEF,
  VEHICLE_STATE_DEF,
  VEHICLE_TYPE_DEF,
  WORK_ORDER_STATUS_DEF,
  WORK_ORDER_TYPE_DEF,
  WORK_UNIT_DEF,
  colorsOf,
  labelsOf
} from '@road-patrol/shared';

/**
 * 畫面上的中文標籤與顏色。
 *
 * **全部由 `@road-patrol/shared` 的定義推導**，這裡不手寫任何一份對照表。
 * 過去前後端各存一份，結果是：材料 `COLD` 後端寫「冷拌瀝青」前端寫「冷瀝青」、
 * 前端多出一個後端沒有的 `OTHER`、標案狀態少了 `SUSPENDED`
 * （一個暫停中的標案在畫面上會顯示成空白）。
 *
 * 推導出來就不可能不一致，而且後端新增一個狀態時，前端自動就有了。
 */

/**
 * 色彩語彙 → CSS 變數。
 *
 * 這一層是前端獨有的：同一個「警告」在日間與夜間是兩個不同的色碼，
 * 由 `styles/global.css` 依 `data-theme` 切換。
 * 共用套件只說「這是警告」，不說它是什麼顏色。
 */
const CSS_VAR = {
  neutral: 'var(--c-neutral)',
  muted: 'var(--c-muted)',
  info: 'var(--c-info)',
  success: 'var(--c-success)',
  warning: 'var(--c-warning)',
  error: 'var(--c-error)'
};

const cssColorsOf = (defs) =>
  Object.fromEntries(Object.entries(colorsOf(defs)).map(([k, v]) => [k, CSS_VAR[v] ?? CSS_VAR.neutral]));

/** 以 key 為代碼的定義，顏色寫在定義裡（車輛、養護等級） */
const cssColorsByKey = (defs) => Object.fromEntries(defs.map((d) => [d.key, CSS_VAR[d.color] ?? CSS_VAR.neutral]));

// ═══ 案件 ═══════════════════════════════════════════════════════

/**
 * 二篩狀態(status)：AI 判讀出來的案件要先經人工確認才算數。
 * 與案件狀態是兩回事 —— 通過二篩的案件才會進入派工流程。
 */
export const CASE_STATUS_LABEL = labelsOf(CASE_STATUS_DEF);
export const CASE_STATUS_COLOR = cssColorsOf(CASE_STATUS_DEF);

/**
 * 案件狀態(needRepair)：地圖與看板的顏色主要看這個。
 *
 * **沒有「已完修」這個值** —— 修完了是派工單的事實(status=3)，不是案件的狀態。
 * 硬塞一個值進去，同一個欄位就會表達兩件事，而報表要分開統計。
 */
export const NEED_REPAIR_LABEL = labelsOf(NEED_REPAIR_DEF);
export const NEED_REPAIR_COLOR = cssColorsOf(NEED_REPAIR_DEF);

/** 人工編輯註記：稽核要看的是「這筆有沒有被人動過」 */
export const EDITED_LABEL = labelsOf(CASE_EDITED_DEF);

/** 案件來源：三種來源在畫面上是三個分頁，資料上是同一張表 */
export const SOURCE_LABEL = labelsOf(CASE_SOURCE_DEF);

/**
 * 破壞類型。
 *
 * key 沿用判讀模型輸出的字串（大小寫也照抄）—— 那是資料庫裡實際存的值，
 * 在前端「整理」成大寫看起來比較整齊，代價是每次比對都要先轉換一次，
 * 而漏轉的地方會安靜地顯示成原始代碼。
 */
export const CRACK_LABEL = labelsOf(CRACK_TYPE_DEF);

/** 破壞程度 */
export const DEGREE_LABEL = labelsOf(DEGREE_DEF);
export const DEGREE_COLOR = { A: CSS_VAR.error, B: CSS_VAR.warning, C: CSS_VAR.neutral };

// ═══ 巡查單與派工單 ═════════════════════════════════════════════

export const MAINTENANCE_LABEL = labelsOf(MAINTENANCE_STATUS_DEF);
export const MAINTENANCE_COLOR = cssColorsOf(MAINTENANCE_STATUS_DEF);

/** 巡查單類型：RB 是當場修掉的，所以多了材料與回填尺寸 */
export const MAINTENANCE_TYPE_LABEL = labelsOf(MAINTENANCE_TYPE_DEF);

export const WORK_ORDER_LABEL = labelsOf(WORK_ORDER_STATUS_DEF);
export const WORK_ORDER_COLOR = cssColorsOf(WORK_ORDER_STATUS_DEF);

/** 派工單類型：PC/PD 是從既有案件轉來的，所以一定帶得到來源案件 */
export const WORK_ORDER_TYPE_LABEL = labelsOf(WORK_ORDER_TYPE_DEF);

/** 施工單位：計價方式不同，所以是分類而不是備註 */
export const WORK_UNIT_LABEL = labelsOf(WORK_UNIT_DEF);

/** 施工材料 */
export const MATERIAL_LABEL = labelsOf(MATERIAL_DEF);

// ═══ 車隊、路段、標案、檢測 ═════════════════════════════════════

export const VEHICLE_STATE_LABEL = labelsOf(VEHICLE_STATE_DEF);
export const VEHICLE_STATE_COLOR = cssColorsByKey(VEHICLE_STATE_DEF);
export const VEHICLE_TYPE_LABEL = labelsOf(VEHICLE_TYPE_DEF);

/**
 * 養護等級色票。
 * 用紅綠燈的直覺順序：綠→黃→橘→紅，不需要圖例也看得懂哪個嚴重。
 */
export const MAINTAIN_LABEL = labelsOf(MAINTAIN_LEVEL_DEF);
export const MAINTAIN_COLOR = cssColorsByKey(MAINTAIN_LEVEL_DEF);

/** 鋪面調查 */
export const SURVEY_METHOD_LABEL = labelsOf(SURVEY_METHOD_DEF);
export const SURVEY_ORDER_STATE_LABEL = labelsOf(SURVEY_ORDER_STATE_DEF);
export const SURVEY_STATUS_LABEL = labelsOf(SURVEY_STATUS_DEF);

/** 標案狀態 */
export const PROJECT_STATE_LABEL = labelsOf(PROJECT_STATE_DEF);

// ═══ 地理資料 ═══════════════════════════════════════════════════

/**
 * 建物用途。
 *
 * 顏色上學校與醫療都是 `error` —— 不是因為它們危險，
 * 而是因為它們是**施工排程必須另外處理**的那兩種，在圖上要一眼看得出來。
 */
export const BUILDING_USAGE_LABEL = labelsOf(BUILDING_USAGE_DEF);
export const BUILDING_USAGE_COLOR = cssColorsByKey(BUILDING_USAGE_DEF);
/** 該用途的施工限制；派工對話框拿它提醒現場 */
export const BUILDING_USAGE_NOTE = Object.fromEntries(BUILDING_USAGE_DEF.map((d) => [d.key, d.note]));

export const REGION_LEVEL_LABEL = labelsOf(REGION_LEVEL_DEF);

// ═══ 車機通訊 ═══════════════════════════════════════════════════

export const COMMAND_ACTION_LABEL = labelsOf(COMMAND_ACTION_DEF);
/** 指令的說明，滑過按鈕會看到 —— 「SNAPSHOT」對督導不是可讀的字 */
export const COMMAND_ACTION_HINT = Object.fromEntries(COMMAND_ACTION_DEF.map((d) => [d.key, d.hint]));
/** 會中斷巡查的指令；送出前要再問一次 */
export const COMMAND_ACTION_DANGER = COMMAND_ACTION_DEF.filter((d) => d.danger).map((d) => d.key);

export const STREAM_STATE_LABEL = labelsOf(STREAM_STATE_DEF);
export const STREAM_STATE_COLOR = cssColorsByKey(STREAM_STATE_DEF);
