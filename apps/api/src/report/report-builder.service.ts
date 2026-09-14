import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REPORT_KIND_DEF } from '@road-patrol/shared';
import { ReportRenderService } from './report-render.service';
import { REPORT_QUERIES } from './kinds';
import type { BuiltReport, ReportParams } from './report.type';

/**
 * 報表產生。
 *
 * 三層各司其職：
 *   kinds/       每一種報表的查詢與欄位宣告(「要印什麼」)
 *   render       排版成 XLSX / DOCX(「長什麼樣」)
 *   這裡         分派、量測、錯誤訊息
 *
 * 分層的實際好處是新增一種報表不會動到排版程式碼 ——
 * 十一種報表共用同一套表頭樣式、數字格式與 Word 版面。
 */
@Injectable()
export class ReportBuilderService implements OnModuleInit {
  private readonly logger = new Logger('ReportBuilder');

  constructor(
    private readonly dataSource: DataSource,
    private readonly renderService: ReportRenderService
  ) {}

  /**
   * 啟動時檢查定義與實作有沒有對齊。
   *
   * 宣告了一種報表卻忘了寫查詢，使用者按下去才會發現 —— 而那時它已經
   * 排進佇列、寫了一筆失敗紀錄。啟動時就講清楚比較便宜。
   */
  onModuleInit(): void {
    const declared: string[] = REPORT_KIND_DEF.map((k) => k.key);
    const implemented = Object.keys(REPORT_QUERIES);

    const missing = declared.filter((k) => !implemented.includes(k));
    const orphan = implemented.filter((k) => !declared.includes(k));

    if (missing.length) this.logger.error(`報表種類已宣告但沒有實作：${missing.join(', ')}`);
    if (orphan.length) this.logger.warn(`報表實作沒有對應的宣告(不會出現在選單)：${orphan.join(', ')}`);
    if (!missing.length && !orphan.length) this.logger.log(`📑 報表種類 ${declared.length} 種已就緒`);
  }

  public async build(kind: string, format: 'XLSX' | 'DOCX', companyId: number, params: ReportParams): Promise<BuiltReport> {
    const query = REPORT_QUERIES[kind];
    if (!query) throw new Error(`不支援的報表種類：${kind}`);

    const started = Date.now();
    const data = await query(this.dataSource, companyId, params);
    const built = await this.renderService.render(data, format);

    this.logger.log(`產生 ${kind} 的 ${format}，共 ${built.rowCount} 列，耗時 ${Date.now() - started} ms`);

    return built;
  }
}
