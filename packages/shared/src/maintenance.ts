import type { ValueDef } from './lookup';

/**
 * 巡查單狀態。
 *
 * 與案件狀態同一套語意 —— 巡查單也是「發現了什麼」而不是「做了什麼」，
 * 所以走的是待確認 → 觀察中 → 已派工這條線，而不是派工單的施工流程。
 */
export const MAINTENANCE_STATUS_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '待確認', color: 'warning' },
  { value: 1, name: '觀察中', color: 'info' },
  { value: 2, name: '已派工', color: 'success' }
] as const satisfies readonly ValueDef[];

/**
 * 巡查單類型。
 *
 * RA 只記錄「看到什麼」；RB 是當場就修掉的，所以多了回填材料與尺寸。
 * 由 RB 改回 RA 時，巡修專屬欄位要一併移除 —— 留著會變成
 * 「一張沒有修過的單上寫著用了幾包冷瀝青」。
 */
export const MAINTENANCE_TYPE_DEF = [
  { key: 'RA', name: '巡查', needRepair: false },
  { key: 'RB', name: '巡修', needRepair: true }
] as const;

/**
 * 巡查單的照片分區與必要照片。
 *
 * 與派工單分開一份：巡查單要的是「現場長什麼樣」，
 * 巡修單多一組修補前後 —— 借用派工單那份分區的話，
 * 一張巡查單的表單上會長出十七格施工照片欄位。
 */
export const MAINTENANCE_IMAGE_GROUPS: Record<string, { group: string; types: string[] }[]> = {
  RA: [{ group: '現況照片', types: ['IMG'] }],
  RB: [
    { group: '現況照片', types: ['IMG'] },
    { group: '修補照片', types: ['IMG_BEFORE', 'IMG_AFTER'] }
  ]
};

/** 巡修(RB)必須有修補前後，否則「當場修掉了」這件事沒有任何憑據 */
export const MAINTENANCE_REQUIRED_IMAGES: Record<string, string[]> = {
  RA: [],
  RB: ['IMG_BEFORE', 'IMG_AFTER']
};

/**
 * 施工單位。
 *
 * 同一個坑洞由誰去修，計價方式完全不同 —— 自主修繕不計價、
 * 廠商修繕依契約單價、公所修繕另案結算。所以這是必填的分類而不是備註。
 */
