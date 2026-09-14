import type { DataSource } from 'typeorm';
import type { ReportData, ReportParams } from '../report.type';

/** 每一種報表就是這樣一個函式：拿公司與參數，回傳「要印什麼」 */
export type ReportQuery = (ds: DataSource, companyId: number, params: ReportParams) => Promise<ReportData>;

/** 報表的資料量上限：沒有上限的匯出遲早會有人點下去然後把記憶體吃光 */
export const ROW_LIMIT = 50_000;

/** 參數取值：查詢字串來的東西型別不可靠，統一在這裡收斂 */
export const str = (params: ReportParams, key: string): string | undefined => {
  const v = params[key];
  return v === undefined || v === null || v === '' ? undefined : String(v);
};

export const num = (params: ReportParams, key: string): number | undefined => {
  const v = params[key];
  return v === undefined || v === null || v === '' ? undefined : Number(v);
};

/**
 * 期間描述。
 *
 * 報表標題底下那一行「統計期間：2026-08-01 ~ 2026-08-31」——
 * 每份報表都要，各寫一次就會出現三種寫法。
 */
export const periodText = (from?: string, to?: string): string => {
  if (!from && !to) return '統計期間：全部';
  return `統計期間：${from ?? '不限'} ~ ${to ?? '不限'}`;
};

/** 月份參數 `YYYY-MM` → 起訖時間；月報與薪資表共用 */
export const monthRange = (month: string): { start: Date; end: Date } => {
  const start = new Date(`${month}-01T00:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  return { start, end };
};

/**
 * 日期區間 → SQL 的上下界。
 *
 * 迄日一律用「隔天的零點」而不是當天的 23:59:59 ——
 * 後者會漏掉最後一秒內的資料，而那一秒在跨日批次上傳時真的會有東西。
 */
export const dayRange = (from?: string, to?: string): { start?: Date; end?: Date } => ({
  start: from ? new Date(`${from}T00:00:00`) : undefined,
  end: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400000) : undefined
});
