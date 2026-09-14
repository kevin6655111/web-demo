import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { ReportService } from './report.service';
import { CreateReportDto, ReportIdDto, ReportQueryDto } from './report.dto';

@ApiTags('Report')
@ApiBearerAuth('bearer')
@Controller()
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /** 建立報表工作 */
  @Post('report')
  @ApiOperation({
    summary: '建立報表(Excel / Word)',
    description: [
      '**非同步產製**：這支只把工作排進佇列並回工作編號，實際產檔在 report-worker 行程。',
      '完成後用 `GET /report/{ID}` 取短效下載網址，或訂閱 WebSocket 的 `report` 頻道等 `report.done` 事件。',
      '',
      '`XLSX` 給要再加工的人(明細 + 統計兩張工作表，數字保持數字型別)；',
      '`DOCX` 給要用印發文的人(統計摘要 + 前 200 筆明細)。',
      '',
      '**去重**：相同條件的報表在完成前重複請求會沿用同一筆工作，不會排出第二份。',
      '',
      '所需權限：`REPORT.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateReportDto,
    examples: {
      monthly: {
        summary: '當月全部案件(Excel)',
        value: { FORMAT: 'XLSX', DATE_FROM: '2026-08-01', DATE_TO: '2026-08-31' }
      },
      official: {
        summary: '完修案件彙整(Word 公文)',
        value: { FORMAT: 'DOCX', STATUS: 'REPAIRED', DATE_FROM: '2026-08-01', DATE_TO: '2026-08-31' }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已排入產製。`data.REUSED` 為 true 表示沿用既有工作' })
  @ApiCommonErrors()
  @Audit({ action: 'REPORT', keys: ['FORMAT', 'STATUS', 'DATE_FROM', 'DATE_TO'] })
  @RequireAction(ACTION.REPORT.CREATE)
  async handleCreateReport(@Body() dto: CreateReportDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.reportService.createReport(dto, user);
  }

  /** 查詢報表狀態與下載網址 */
  /**
   * 報表種類。
   *
   * 必須宣告在 `report/:ID` 之前 —— Nest 依宣告順序比對路由，
   * 反過來的話 `kind` 會被當成 id，得到「ID must be an integer number」。
   */
  @Get('report/kind')
  @ApiOperation({
    summary: '報表種類清單',
    description: [
      '十一種報表的代碼、中文名、所屬分類、接受的參數群組與可用格式。',
      '',
      '前端依 `PARAMS` 決定要顯示哪些條件欄位 —— 月報要選月份、鋪面報表要選委託單，',
      '把所有欄位一次攤開會讓使用者填一堆不會被用到的條件。',
      '',
      '所需權限：`REPORT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.REPORT.READ)
  handleGetKinds(): HttpResult {
    return this.reportService.getKinds();
  }

  @Get('report/:ID')
  @ApiOperation({
    summary: '查詢報表狀態',
    description: [
      '回傳目前狀態；完成時附上 5 分鐘有效的下載網址。',
      '網址每次都重新簽發 —— 不要把它存起來重複使用。',
      '',
      '所需權限：`REPORT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`STATE` 為 DONE 時 `DOWNLOAD_URL` 才有值' })
  @ApiCommonErrors({ notFound: '找不到該報表工作' })
  @RequireAction(ACTION.REPORT.READ)
  async handleGetReport(@Param() param: ReportIdDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.reportService.getReport(param.ID, user.companyId);
  }

  /** 刪除報表 */
  @Delete('report/:ID')
  @ApiOperation({
    summary: '刪除報表',
    description: [
      '刪除工作紀錄，並一併刪掉物件儲存上的檔案 ——',
      '只刪紀錄的話，檔案會變成沒人知道它存在的孤兒。',
      '',
      '產製中的報表不能刪：worker 還在寫那個檔案。',
      '',
      '所需權限：`REPORT.CREATE`（能產生就能刪除自己排的報表）'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已刪除' })
  @ApiCommonErrors({ notFound: '找不到該報表', conflict: '報表產製中，無法刪除' })
  @Audit({ action: 'REPORT', keys: ['ID'] })
  @RequireAction(ACTION.REPORT.CREATE)
  async handleDeleteReport(@Param() param: ReportIdDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.reportService.deleteReport(param.ID, user.companyId);
  }

  /** 報表清單 */
  @Get('report')
  @ApiOperation({
    summary: '報表清單',
    description: [
      '最近 50 筆報表工作，可用 `KIND` 只看某一種。超過 7 天的紀錄由排程自動清理。',
      '',
      '`TITLE` 是產生當下的種類名稱快照 —— 中文名以後改了，舊報表仍對得上當時的叫法。',
      '',
      '所需權限：`REPORT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.REPORT.READ)
  async handleListReports(@Query() dto: ReportQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.reportService.listReports(user.companyId, dto);
  }
}
