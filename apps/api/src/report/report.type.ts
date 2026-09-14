/**
 * 報表的中間表示。
 *
 * 十一種報表如果各自寫一份 ExcelJS 樣板，同一段排版邏輯就要抄十一次 ——
 * 而「表頭要不要凍結、數字欄位要不要右對齊、日期用什麼格式」這些決定
 * 每抄一次就多一個走樣的機會。
 *
 * 所以查詢只負責**宣告資料長什麼樣**，排版交給單一的渲染器：
 * 新增一種報表 = 一段 SQL 加一份欄位定義，不碰任何排版程式碼。
 */

/** 一個欄位；`type` 決定對齊與數字格式，不是決定值的型別 */
export type ReportColumn = {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'date' | 'datetime';
  /** 小數位；只對 number 有意義 */
  digits?: number;
};

/** 一張工作表 */
export type ReportSheet = {
  name: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** 表格上方的摘要列；Word 版會變成條列 */
  summary?: { label: string; value: string | number }[];
  /** 這張表的說明；印在表格下方 */
  note?: string;
};

/** 一份報表 */
export type ReportData = {
  title: string;
  /** 統計期間或範圍的描述 */
  period?: string;
  sheets: ReportSheet[];
};

/** 產出物 */
export type BuiltReport = { buffer: Buffer; rowCount: number };

/** 報表查詢參數；各種報表接受的鍵不同，由 REPORT_KIND_DEF 宣告 */
export type ReportParams = Record<string, unknown>;
