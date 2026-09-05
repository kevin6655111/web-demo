import type { ValueDef } from './lookup';

/**
 * 檢測案件狀態。
 */
export const SURVEY_STATUS_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '未檢查', color: 'warning' },
  { value: 1, name: '已檢查', color: 'success' }
] as const satisfies readonly ValueDef[];

/**
 * 派工單的狀態「動作碼」。
 *
 * 這些不是會被存下來的狀態，而是送給 API 的指令 ——
 * 撤回是把單退回上一步、復原是把已刪除的單救回來。
 * 與狀態值混在同一個列舉裡的話，資料庫會出現 `status = 9` 這種不存在的狀態。
 */

/** 調查時段與天氣：巡查單的必填欄位，影響判定基準 */
export const PERIOD_DEF = [
  { key: 'AM', name: '上午' },
  { key: 'PM', name: '下午' }
] as const;

export const WEATHER_DEF = [
  { key: '晴', name: '晴' },
  { key: '陰', name: '陰' },
  { key: '雨', name: '雨' }
] as const;
