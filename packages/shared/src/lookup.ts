/**
 * 狀態色的語彙。
 *
 * 六個語意詞而不是色碼：同一個「警告」在日間與夜間是兩個不同的顏色，
 * 而「這個狀態算不算警告」是領域知識，不該跟著佈景走。
 * 前端把它接到 CSS 變數，後端原樣回給 `/core/code`。
 */
export type ColorToken = 'neutral' | 'muted' | 'info' | 'success' | 'warning' | 'error';

/** 以數字為代碼的定義（狀態類）*/
export type ValueDef = { readonly value: number; readonly name: string; readonly color: ColorToken };

/** 以字串為代碼的定義（類型類）*/
export type KeyDef = { readonly key: string; readonly name: string };

/**
 * 定義陣列 → 「代碼 → 中文」對照表。
 *
 * 前端過去是手寫這些對照表的，於是同一份資料存在兩處 ——
 * 實際上也真的分岔過（後端的 `COLD` 是「冷拌瀝青」，前端寫成「冷瀝青」）。
 * 從定義推導出來就不可能不一致。
 */
export function labelsOf<T extends ValueDef>(defs: readonly T[]): Record<number, string>;
export function labelsOf<T extends KeyDef>(defs: readonly T[]): Record<string, string>;
export function labelsOf(defs: readonly (ValueDef | KeyDef)[]): Record<string | number, string> {
  return Object.fromEntries(defs.map((d) => ['value' in d ? d.value : d.key, d.name]));
}

/** 定義陣列 → 「代碼 → 色彩語彙」對照表 */
export function colorsOf(defs: readonly ValueDef[]): Record<number, ColorToken> {
  return Object.fromEntries(defs.map((d) => [d.value, d.color]));
}

/** 定義陣列 → 代碼清單；用於 DTO 的 `@IsIn` 與前端的下拉選項 */
export function keysOf<T extends KeyDef>(defs: readonly T[]): T['key'][] {
  return defs.map((d) => d.key);
}

export function valuesOf<T extends ValueDef>(defs: readonly T[]): number[] {
  return defs.map((d) => d.value);
}

/** 查單一筆定義；查不到回 undefined，由呼叫端決定要顯示原始代碼還是空白 */
export function findByKey<T extends KeyDef>(defs: readonly T[], key: string | null | undefined): T | undefined {
  return defs.find((d) => d.key === key);
}

export function findByValue<T extends ValueDef>(defs: readonly T[], value: number | null | undefined): T | undefined {
  return defs.find((d) => d.value === value);
}
