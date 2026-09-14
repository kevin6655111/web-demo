import type { ValueDef } from './lookup';

// ═══ 破壞 ═══════════════════════════════════════════════════════

/**
 * 破壞分類。
 *
 * 依縣市不同 —— 同一種破壞，臺北叫「人手孔缺失」，其他縣市叫「人手孔蓋未平順」。
 * 報表要交給業主，用錯名稱會被退件。
 */
export const CRACK_TYPE_DEF = [
  { key: 'Cover', name: '人手孔蓋未平順', nameTaipei: '人手孔缺失' },
  { key: 'Potholes', name: '坑洞', nameTaipei: '坑洞' },
  { key: 'Patch', name: '補綻', nameTaipei: '補綻' },
  { key: 'Cracking', name: '線狀裂縫', nameTaipei: '縱向及橫向裂縫' },
  { key: 'Alligator_Cracking', name: '鱷魚狀裂縫', nameTaipei: '龜裂' },
  { key: 'Rutting', name: '車轍', nameTaipei: '車轍' },
  { key: 'Subsidence', name: '路基下陷', nameTaipei: '路基下陷' }
] as const;

export type CrackTypeKey = (typeof CRACK_TYPE_DEF)[number]['key'];

/**
 * 破壞類型的別名。
 *
 * 不同世代的車機與不同縣市的判讀模型，輸出的類型字串不一樣：
 * 舊車機送 `pothole`、有的模型送中文、臺北格式送 `Manhole`。
 * 進系統時一律轉成 `CRACK_TYPE_DEF` 的 key —— 否則同一種破壞在統計上會被拆成三種。
 * 查不到別名時保留原值並讓驗證擋下，不要猜。
 */
export const CRACK_TYPE_ALIAS: Record<string, CrackTypeKey> = {
  pothole: 'Potholes',
  potholes: 'Potholes',
  坑洞: 'Potholes',
  manhole: 'Cover',
  Manhole: 'Cover',
  cover: 'Cover',
  人手孔: 'Cover',
  patch: 'Patch',
  補綻: 'Patch',
  crack: 'Cracking',
  cracking: 'Cracking',
  linear_crack: 'Cracking',
  線狀裂縫: 'Cracking',
  alligator: 'Alligator_Cracking',
  alligator_cracking: 'Alligator_Cracking',
  龜裂: 'Alligator_Cracking',
  鱷魚狀裂縫: 'Alligator_Cracking',
  rutting: 'Rutting',
  車轍: 'Rutting',
  subsidence: 'Subsidence',
  路基下陷: 'Subsidence'
};

/** 把車機送來的類型字串正規化成系統代碼；認不得的原樣回傳 */
export function normalizeCrackType(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (CRACK_TYPE_DEF.some((d) => d.key === trimmed)) return trimmed;
  return CRACK_TYPE_ALIAS[trimmed] ?? CRACK_TYPE_ALIAS[trimmed.toLowerCase()] ?? trimmed;
}

/** 破壞程度：A 最嚴重 */
export const DEGREE_DEF = [
  { key: 'A', name: '嚴重' },
  { key: 'B', name: '中等' },
  { key: 'C', name: '輕微' }
] as const;

/**
 * 派工單類型。
 *
 * 前兩種是自行發起的工程，後兩種從既有案件轉來 ——
 * 所以 PC/PD 建立時必須帶來源案件 id，否則會出現「修了但不知道在修什麼」的單。
 */

// ═══ 車巡案件的三組狀態 ═════════════════════════════════════════

/**
 * 車巡案件的三組狀態。
 *
 * 拆成三組而不是一個欄位，因為它們是三個獨立的判斷、由不同的人在不同時間做：
 *   status      二篩結果 —— 這是不是真的破壞
 *   edited      有沒有被人工修改過 —— 稽核用
 *   needRepair  要不要修 —— 養護判斷，跟「是不是破壞」是兩回事
 */
export const CASE_STATUS_DEF = [
  { value: 0, name: '未審', color: 'neutral' },
  { value: 1, name: '通過', color: 'success' },
  { value: 2, name: '待審', color: 'warning' },
  { value: 3, name: '刪除', color: 'neutral' },
  { value: 4, name: '誤判', color: 'error' }
] as const satisfies readonly ValueDef[];

export const CASE_EDITED_DEF = [
  { value: 0, name: '未編輯' },
  { value: 1, name: '已編輯' },
  { value: 2, name: '刪除' }
] as const;

export const NEED_REPAIR_DEF = [
  { value: -1, name: '已刪除', color: 'error' },
  { value: 0, name: '待確認', color: 'warning' },
  { value: 1, name: '觀察中', color: 'info' },
  { value: 2, name: '已派工', color: 'success' }
] as const satisfies readonly ValueDef[];

/** 施工材料 */
