/**
 * 車輛、標案、路段、檢測的列舉。
 *
 * 這些原本是後端實體檔裡的字串陣列（只有代碼、沒有中文），
 * 前端則另外手寫一份中文對照 —— 於是前端的標案狀態少了 `SUSPENDED`，
 * 一個暫停中的標案在畫面上會顯示成空白。
 *
 * 代碼與中文放在一起就沒有這種漏法：新增一個狀態時，
 * 沒有中文名的地方編譯就過不去。
 */

/** 案件來源：三種來源在畫面上是三個分頁，資料上是同一張表 */
export const CASE_SOURCE_DEF = [
  { key: 'VEHICLE', name: 'AI 車巡' },
  { key: 'APP', name: 'APP 巡查' },
  { key: 'SIDEWALK', name: '通道案件' }
] as const;

export type CaseSource = (typeof CASE_SOURCE_DEF)[number]['key'];

export const VEHICLE_TYPE_DEF = [
  { key: 'PATROL', name: '巡查車' },
  { key: 'REPAIR', name: '維修車' },
  { key: 'SURVEY', name: '檢測車' }
] as const;

export type VehicleType = (typeof VEHICLE_TYPE_DEF)[number]['key'];

/** 車輛狀態；顏色與案件無關，走的是「連得上／連不上」的直覺 */
export const VEHICLE_STATE_DEF = [
  { key: 'ONLINE', name: '在線', color: 'success' },
  { key: 'IDLE', name: '待命', color: 'info' },
  { key: 'OFFLINE', name: '離線', color: 'neutral' },
  { key: 'DISABLED', name: '停用', color: 'error' }
] as const;

export type VehicleState = (typeof VEHICLE_STATE_DEF)[number]['key'];

/**
 * 養護等級色票。
 * 用紅綠燈的直覺順序：綠→黃→橘→紅，不需要圖例也看得懂哪個嚴重。
 */
export const MAINTAIN_LEVEL_DEF = [
  { key: 'GOOD', name: '良好', color: 'success' },
  { key: 'FAIR', name: '尚可', color: 'warning' },
  { key: 'POOR', name: '不良', color: 'muted' },
  { key: 'CRITICAL', name: '危險', color: 'error' }
] as const;

export type MaintainLevel = (typeof MAINTAIN_LEVEL_DEF)[number]['key'];

/** 標案狀態；`SUSPENDED` 是合約暫停，不是結案 —— 兩者的請款處理完全不同 */
export const PROJECT_STATE_DEF = [
  { key: 'DRAFT', name: '草稿' },
  { key: 'ACTIVE', name: '執行中' },
  { key: 'SUSPENDED', name: '暫停中' },
  { key: 'CLOSED', name: '已結案' }
] as const;

export type ProjectState = (typeof PROJECT_STATE_DEF)[number]['key'];

export const SURVEY_METHOD_DEF = [
  { key: 'VISUAL', name: '目視' },
  { key: 'CORE_DRILL', name: '鑽心取樣' },
  { key: 'FWD', name: '落重撓度' },
  { key: 'ROUGHNESS', name: '平坦度' }
] as const;

export type SurveyMethod = (typeof SURVEY_METHOD_DEF)[number]['key'];

export const SURVEY_ORDER_STATE_DEF = [
  { key: 'DRAFT', name: '草稿' },
  { key: 'ISSUED', name: '已發出' },
  { key: 'SURVEYING', name: '調查中' },
  { key: 'REVIEWING', name: '審核中' },
  { key: 'CLOSED', name: '結案' }
] as const;

export type SurveyOrderState = (typeof SURVEY_ORDER_STATE_DEF)[number]['key'];
