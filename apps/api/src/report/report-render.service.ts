import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import type { BuiltReport, ReportColumn, ReportData, ReportSheet } from './report.type';

/** Word 版每張表最多列這麼多列；超過請看 Excel */
const DOCX_ROW_LIMIT = 200;

/** 表頭底色：深藍配白字，列印成灰階也還分得出表頭 */
const HEADER_FILL = 'FF1F3A5F';

/**
 * 報表排版。
 *
 * 兩種格式服務兩種讀者：
 *   XLSX  給要再加工的人 —— 欄位齊全、可篩選、數字是數字不是字串
 *   DOCX  給要用印發文的人 —— 有標題、統計摘要、表格，格式固定
 *
 * 所有報表共用這一份排版：新增一種報表不會多出一種長相。
 */
@Injectable()
export class ReportRenderService {
  /** 全部工作表的資料列總數；工作紀錄上顯示的就是它 */
  public rowCount(data: ReportData): number {
    return data.sheets.reduce((sum, s) => sum + s.rows.length, 0);
  }

  public async render(data: ReportData, format: 'XLSX' | 'DOCX'): Promise<BuiltReport> {
    const buffer = format === 'XLSX' ? await this.toXlsx(data) : await this.toDocx(data);
    return { buffer, rowCount: this.rowCount(data) };
  }

  // ─── Excel ─────────────────────────────────────────────────────

  private async toXlsx(data: ReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '道路巡查 Demo';
    workbook.created = new Date();

    for (const sheet of data.sheets) {
      // 工作表名稱有 31 字元上限與禁用字元，超過會讓整個檔案打不開
      const ws = workbook.addWorksheet(this.safeSheetName(sheet.name), {
        views: [{ state: 'frozen', ySplit: sheet.summary?.length ? sheet.summary.length + 2 : 1 }]
      });

      let headerRow = 1;

      if (sheet.summary?.length) {
        for (const item of sheet.summary) {
          const row = ws.addRow([item.label, item.value]);
          row.getCell(1).font = { bold: true };
        }
        ws.addRow([]);
        headerRow = sheet.summary.length + 2;
      }

      ws.addRow(sheet.columns.map((c) => c.header));
      const header = ws.getRow(headerRow);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };

      for (const row of sheet.rows) ws.addRow(sheet.columns.map((c) => this.cellValue(c, row[c.key])));

      sheet.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = c.width ?? this.autoWidth(c);

        // 數字保持數字型別：使用者拿去做樞紐分析時才不用再轉一次
        if (c.type === 'number') col.numFmt = c.digits === 0 ? '0' : `0.${'0'.repeat(c.digits ?? 2)}`;
        if (c.type === 'date') col.numFmt = 'yyyy/mm/dd';
        if (c.type === 'datetime') col.numFmt = 'yyyy/mm/dd hh:mm';
      });

      if (sheet.rows.length) {
        const lastCol = String.fromCharCode(64 + Math.min(sheet.columns.length, 26));
        ws.autoFilter = { from: `A${headerRow}`, to: `${lastCol}${headerRow}` };
      }

      if (sheet.note) {
        ws.addRow([]);
        ws.addRow([sheet.note]).font = { italic: true, size: 9 };
      }
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Excel 的工作表名稱限制：31 字元，且不能有 : \ / ? * [ ] */
  private safeSheetName(name: string): string {
    return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
  }

  /** 沒指定寬度時依表頭長度估：中文字大約佔兩個字元寬 */
  private autoWidth(column: ReportColumn): number {
    const width = [...column.header].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    return Math.max(10, Math.min(30, width + 4));
  }

  private cellValue(column: ReportColumn, value: unknown): unknown {
    if (value === null || value === undefined) return '';
    if (column.type === 'number') return Number(value);
    if (column.type === 'date' || column.type === 'datetime') return new Date(value as string);
    return value;
  }

  // ─── Word ──────────────────────────────────────────────────────

  private async toDocx(data: ReportData): Promise<Buffer> {
    const children: (Paragraph | Table)[] = [
      new Paragraph({ text: data.title, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER })
    ];

    if (data.period) children.push(new Paragraph({ text: data.period, alignment: AlignmentType.CENTER }));
    children.push(new Paragraph({ text: '' }));

    data.sheets.forEach((sheet, index) => {
      children.push(new Paragraph({ text: `${this.chineseNumber(index + 1)}、${sheet.name}`, heading: HeadingLevel.HEADING_2 }));

      for (const item of sheet.summary ?? []) children.push(new Paragraph(`${item.label}：${item.value}`));
      if (sheet.summary?.length) children.push(new Paragraph({ text: '' }));

      if (!sheet.rows.length) {
        children.push(new Paragraph('（無資料）'));
        children.push(new Paragraph({ text: '' }));
        return;
      }

      const preview = sheet.rows.slice(0, DOCX_ROW_LIMIT);
      children.push(this.buildTable(sheet, preview));

      if (sheet.rows.length > preview.length) {
        children.push(new Paragraph(`（本項共 ${sheet.rows.length} 筆，本文件列出前 ${preview.length} 筆，完整明細請看 Excel 版）`));
      }
      if (sheet.note) children.push(new Paragraph({ text: sheet.note }));

      children.push(new Paragraph({ text: '' }));
    });

    children.push(
      new Paragraph({
        text: `本報告由系統於 ${new Date().toLocaleString('zh-TW', { hour12: false })} 產生，資料為示範用途。`,
        alignment: AlignmentType.RIGHT
      })
    );

    return await Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  private buildTable(sheet: ReportSheet, rows: Record<string, unknown>[]): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: sheet.columns.map(
            (c) =>
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.header, bold: true })] })] })
          )
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              children: sheet.columns.map(
                (c) => new TableCell({ children: [new Paragraph(this.textValue(c, row[c.key]))] })
              )
            })
        )
      ]
    });
  }

  private textValue(column: ReportColumn, value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    if (column.type === 'number') return Number(value).toFixed(column.digits ?? 2);
    if (column.type === 'date') return new Date(value as string).toLocaleDateString('zh-TW');
    if (column.type === 'datetime') return new Date(value as string).toLocaleString('zh-TW', { hour12: false });
    return String(value);
  }

  /** 公文的節次習慣用中文數字 */
  private chineseNumber(n: number): string {
    const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    return n <= 10 ? digits[n] : `${digits[Math.floor(n / 10)]}十${n % 10 ? digits[n % 10] : ''}`;
  }
}
