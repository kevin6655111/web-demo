import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { SurveyService } from './survey.service';
import {
  ExpertSurveyQueryDto,
  SurveyCaseQueryDto,
  SurveyCaseStatusDto,
  SurveyOrderQueryDto,
  TransferSurveyCaseDto,
  UpsertSurveyCaseDto,
  UpsertSurveyDetailDto,
  UpsertSurveyOrderDto
} from './survey.dto';

@ApiTags('Survey')
@ApiBearerAuth(API_AUTH)
@Controller()
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  /** 委託單清單 */
  @Get('survey/order')
  @ApiOperation({
    summary: '調查委託單清單',
    description: [
      '與派工單的差別：派工是「去修」，委託是「去看」。',
      '調查通常在驗收前或發生爭議時才做，一張委託單底下有多個調查點。',
      '',
      '回應含完成進度，不必再逐張點進去看。',
      '',
      '所需權限：`SURVEY.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SURVEY.READ)
  async handleListOrders(@Query() dto: SurveyOrderQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.listOrders(dto, user.companyId);
  }

  /** 新增或更新委託單 */
  @Post('survey/order')
  @ApiOperation({
    summary: '新增或更新委託單',
    description: ['單號由系統依日期自動編碼(`SV-YYYYMMDD-序號`)，不需傳入。', '', '所需權限：`SURVEY.UPDATE`'].join(
      '\n'
    )
  })
  @ApiBody({
    type: UpsertSurveyOrderDto,
    examples: {
      dispute: {
        summary: '爭議調查',
        value: {
          TITLE: '臺灣大道路面爭議調查',
          REQUESTER: '示範市政府建設局',
          SURVEYOR_ID: 3,
          DUE_DATE: '2026-09-15',
          STATE: 'ISSUED'
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ notFound: '找不到該委託單' })
  @Audit({ action: 'SURVEY', keys: ['ID', 'TITLE', 'STATE'] })
  @RequireAction(ACTION.SURVEY.UPDATE)
  async handleUpsertOrder(@Body() dto: UpsertSurveyOrderDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.upsertOrder(dto, user.companyId);
  }

  /** 調查點清單 */
  @Get('survey/case')
  @ApiOperation({
    summary: '調查點清單',
    description: [
      '一個調查點就是一次實地量測。`METHOD` 決定可信度，報告會標示出來。',
      '',
      '所需權限：`SURVEY.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SURVEY.READ)
  async handleListCases(@Query() dto: SurveyCaseQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.listCases(dto, user.companyId);
  }

  /** 新增或更新調查點 */
  @Post('survey/case')
  @ApiOperation({
    summary: '新增或更新調查點',
    description: [
      '調查完成(`STATE: DONE`)且帶有 `PCI` 與 `SEGMENT_ID` 時，',
      '**會一併回寫該路段的評分** —— 實地量測的可信度高於用案件密度推算的分數。',
      '',
      '兩者在同一個交易裡，不會只更新一半。養護等級一律由 PCI 重新推導。',
      '',
      '所需權限：`SURVEY.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpsertSurveyCaseDto,
    examples: {
      visual: {
        summary: '目視調查(尚未完成)',
        value: { ORDER_ID: 1, LNG: 120.6478, LAT: 24.1636, METHOD: 'VISUAL', ROAD_NAME: '中山路一段' }
      },
      core: {
        summary: '鑽心取樣完成，回寫路段',
        value: {
          ORDER_ID: 1,
          LNG: 120.6478,
          LAT: 24.1636,
          METHOD: 'CORE_DRILL',
          SEGMENT_ID: 3,
          THICKNESS_CM: 12.5,
          PCI: 58,
          IRI: 3.8,
          STATE: 'DONE',
          FINDING: '面層厚度不足，建議整段刨鋪'
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ notFound: '找不到委託單或調查點' })
  @Audit({ action: 'SURVEY', keys: ['ID', 'ORDER_ID', 'METHOD', 'STATE'] })
  @RequireAction(ACTION.SURVEY.UPDATE)
  async handleUpsertCase(@Body() dto: UpsertSurveyCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.upsertCase(dto, user.companyId, user.uid);
  }
  // ═══ 委託明細 ═══════════════════════════════════════════════════

  @Get('survey/order/:ID/detail')
  @ApiOperation({
    summary: '查詢委託明細',
    description: [
      '業主給的委託通常不是「去看某一個點」，而是一份路段清單：',
      '哪一條路、從哪個樁號到哪個樁號、要取幾個樣、單雙向、幾車道。',
      '',
      '每一項都附已完成的取樣數與進度 —— 沒有這一層，',
      '「這張委託單做完了沒有」只能靠人去數點位，而漏做一個樣點在驗收時才會被發現。',
      '',
      '所需權限：`SURVEY.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'ID', example: 1, description: '委託單 id' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到委託單' })
  @RequireAction(ACTION.SURVEY.READ)
  async handleListDetails(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.listDetails(id, user.companyId);
  }

  @Post('survey/order/detail')
  @ApiOperation({
    summary: '新增或更新委託明細',
    description: [
      '有帶 `ID` 就是更新。序號省略時接在最後 —— 業主給的清單是有順序的，插號會讓報表對不上。',
      '',
      '樁號用 `STATION_K` + `STATION_M` 兩個整數而不是字串：報表要依樁號排序。',
      '顯示時組成 `3K+250`。',
      '',
      '所需權限：`SURVEY.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpsertSurveyDetailDto,
    examples: {
      create: {
        summary: '新增一段路',
        value: {
          ORDER_ID: 1,
          ROAD: '中山路一段',
          ROAD_START: '文心路口',
          ROAD_END: '大墩路口',
          STATION_K: 3,
          STATION_M: 250,
          DIRECTION: 'BOTH',
          LANE_COUNT: 4,
          SAMPLE_COUNT: 3,
          ROAD_LENGTH_M: 1250.5,
          ROAD_WIDTH_M: 12.5
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ notFound: '找不到委託單或明細', conflict: '明細序號已存在' })
  @Audit({ action: 'SURVEY', keys: ['ORDER_ID', 'ROAD', 'SEQ'] })
  @RequireAction(ACTION.SURVEY.UPDATE)
  async handleUpsertDetail(@Body() dto: UpsertSurveyDetailDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.upsertDetail(dto, user.companyId);
  }

  // ═══ 批次狀態與轉讓 ═════════════════════════════════════════════

  @Put('survey/case/status')
  @ApiOperation({
    summary: '批次更新調查點狀態',
    description: [
      '一趟現場會收十幾個點，逐筆送十幾次沒有人會做。',
      '',
      '`DELETED` 是**軟刪除**：業主會要一張「已刪除案件表」——',
      '硬刪除之後那張報表永遠是空的，而「為什麼這個樣點不見了」在驗收時一定會被問。',
      '',
      '已結案的委託單底下不可再改：結案代表報告已經送出去了。被跳過的會附上原因。',
      '',
      '所需權限：`SURVEY.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: SurveyCaseStatusDto,
    examples: {
      done: { summary: '標記完成', value: { IDS: [5, 6], STATE: 'DONE' } },
      remove: { summary: '軟刪除', value: { IDS: [7], STATE: 'DELETED', REASON: '路段重複取樣' } }
    }
  })
  @ApiResponse({ status: 200, description: '已更新；`data.SKIPPED` 列出被跳過的與原因' })
  @ApiCommonErrors({ badRequest: '未指定調查點' })
  @Audit({ action: 'SURVEY', keys: ['IDS', 'STATE'] })
  @RequireAction(ACTION.SURVEY.UPDATE)
  async handleBatchStatus(@Body() dto: SurveyCaseStatusDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.batchStatus(dto, user);
  }

  // ═══ 專家系統 ═══════════════════════════════════════════════════

  @Get('survey/expert/case')
  @ApiOperation({
    summary: '專家系統：調查點全欄位清單',
    description: [
      '與一般清單的差別是「看得到全部」：所有現場欄位(車道、樁號、天氣、破壞尺寸)，',
      '以及**已刪除的案件**(`INCLUDE_DELETED=true`)。',
      '',
      '專家要判斷的是「這批資料能不能用」，而被刪掉的那幾筆往往正是問題所在。',
      '',
      '所需權限：`SURVEY.EXPERT`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SURVEY.EXPERT)
  async handleExpertList(@Query() dto: ExpertSurveyQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.expertList(dto, user.companyId);
  }

  @Put('survey/expert/transfer')
  @ApiOperation({
    summary: '專家系統：轉讓案件',
    description: [
      '把調查點搬到另一張委託單。現場常發生「這個點其實屬於另一張委託單」——',
      '刪掉重建會失去現場照片與量測值，所以是搬移而不是重來。',
      '',
      '`REASON` 必填並寫進歷程：驗收時要說得出這個點原本屬於誰。',
      '已結案的委託單不可再轉入。',
      '',
      '所需權限：`SURVEY.EXPERT`'
    ].join('\n')
  })
  @ApiBody({
    type: TransferSurveyCaseDto,
    examples: {
      move: { summary: '轉到另一張委託單', value: { IDS: [5, 6], TO_ORDER_ID: 2, REASON: '原委託單範圍誤植' } }
    }
  })
  @ApiResponse({ status: 200, description: '已轉讓' })
  @ApiCommonErrors({ badRequest: '目標委託單已結案，或沒有需要轉讓的案件', notFound: '找不到目標委託單或明細' })
  @Audit({ action: 'SURVEY', keys: ['IDS', 'TO_ORDER_ID'] })
  @RequireAction(ACTION.SURVEY.EXPERT)
  async handleTransfer(@Body() dto: TransferSurveyCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.transfer(dto, user);
  }

}
