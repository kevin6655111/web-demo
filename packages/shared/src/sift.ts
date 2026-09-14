import type { KeyDef } from './lookup';

/**
 * 二篩。
 *
 * AI 判讀出來的案件要先經人工確認才算數：第一層由二篩人員看圖決定「是不是破壞」，
 * 第二層由管理者覆核。兩層分別記錄在 `patrol_case_statuses` 的 `upd_status_usr`
 * 與 `upd_status_adm`，管理者的紀錄不會被使用者的後續操作蓋掉。
 *
 * 兩種頁面的差別在「看誰的結果」：
 *   GENERAL 二篩人員看未審的案件，逐張判定
 *   MANAGE  管理者看已判定的案件，覆核並計算薪資
 */
export const SIFT_PAGE_DEF = [
  { key: 'GENERAL', name: '二篩作業' },
  { key: 'MANAGE', name: '二篩管理' }
] as const satisfies readonly KeyDef[];

export type SiftPage = (typeof SIFT_PAGE_DEF)[number]['key'];

/**
 * 薪資計價。
 *
 * 每判定一件計一筆單價；被管理者覆核為誤判的，扣一筆錯誤價 ——
 * 扣款高於單價是刻意的：亂按通過比不按更糟，因為錯的案件會被派工。
 * 這兩個數字是契約條件，站台可在 config 覆寫。
 */
export const SIFT_PAY_DEFAULT = { unitPrice: 0.15, errorPrice: 0.3 } as const;
