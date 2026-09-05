import type { ValueDef } from './lookup';

/**
 * 派工單類型。
 *
 * 前兩種是自行發起的工程，後兩種從既有案件轉來 ——
 * 所以 PC/PD 建立時必須帶來源案件 id，否則會出現「修了但不知道在修什麼」的單。
 */
export const WORK_ORDER_TYPE_DEF = [
  { key: 'PA', name: '刨除加封', needSource: null },
  { key: 'PB', name: '路基改善', needSource: null },
  { key: 'PC', name: 'AI 車巡', needSource: 'CASE_PATROL_ID' },
  { key: 'PD', name: 'APP 巡查', needSource: 'MAINTENANCE_ID' }
] as const;

/** 派工單狀態 */
export const WORK_ORDER_STATUS_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '待處理', color: 'neutral' },
  { value: 1, name: '施工中', color: 'warning' },
  { value: 2, name: '已回報', color: 'info' },
  { value: 3, name: '已完工', color: 'success' }
] as const satisfies readonly ValueDef[];

/**
 * 檢測案件狀態。
 */

/**
 * 派工單的狀態「動作碼」。
 *
 * 這些不是會被存下來的狀態，而是送給 API 的指令 ——
 * 撤回是把單退回上一步、復原是把已刪除的單救回來。
 * 與狀態值混在同一個列舉裡的話，資料庫會出現 `status = 9` 這種不存在的狀態。
 */
export const WORK_ORDER_ACTION = {
  RESTORE: 8,
  WITHDRAW: 9
} as const;

/**
 * 巡查單狀態。
 *
 * 與案件狀態同一套語意 —— 巡查單也是「發現了什麼」而不是「做了什麼」，
 * 所以走的是待確認 → 觀察中 → 已派工這條線，而不是派工單的施工流程。
 */

/**
 * 施工單位。
 *
 * 同一個坑洞由誰去修，計價方式完全不同 —— 自主修繕不計價、
 * 廠商修繕依契約單價、公所修繕另案結算。所以這是必填的分類而不是備註。
 */
export const WORK_UNIT_DEF = [
  { key: 'SELF', name: '自主修繕' },
  { key: 'VENDOR', name: '廠商修繕' },
  { key: 'OFFICE', name: '公所修繕' }
] as const;

/**
 * 施工人員「未指定」。
 *
 * 派工單允許還沒指派人員 —— 現場常是先開單、隔天早上點名才分工。
 * 對外一律用 id 0 表示，關聯表裡不會有這一筆；寫入時帶 0 等於清空指派。
 * 用 null 表達的話，「沒指派」與「欄位沒送」在 PATCH 裡分不出來。
 */
export const UNASSIGNED_WORKER = { ID: 0, NAME: '未指定人員' } as const;

/**
 * 派工單推進到這個狀態(含)以上，來源巡查單就不允許刪除。
 *
 * 已回報代表現場已經動工並回報了 —— 這時把來源單刪掉，
 * 派工單就會變成一張「不知道在修什麼」的孤兒單，而驗收要看的正是那張來源單。
 */
export const ORDER_LOCKED_FROM = 2;

/**
 * 車巡案件的三組狀態。
 *
 * 拆成三組而不是一個欄位，因為它們是三個獨立的判斷、由不同的人在不同時間做：
 *   status      二篩結果 —— 這是不是真的破壞
 *   edited      有沒有被人工修改過 —— 稽核用
 *   needRepair  要不要修 —— 養護判斷，跟「是不是破壞」是兩回事
 */

/** 施工材料 */
export const MATERIAL_DEF = [
  { key: 'AC', name: '瀝青混凝土' },
  { key: 'CC', name: '水泥混凝土' },
  { key: 'COLD', name: '冷拌瀝青' },
  { key: 'SEAL', name: '填縫料' }
] as const;

/** 試驗項目(路基改善取樣後要做的) */
export const TEST_ITEM_DEF = ['壓實度', '厚度', '瀝青含量', '篩分析', '平坦度'] as const;

/** 調查時段與天氣：巡查單的必填欄位，影響判定基準 */
