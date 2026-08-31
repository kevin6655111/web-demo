import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { SurveyService } from './survey.service';
import { SurveyCaseQueryDto, SurveyOrderQueryDto, UpsertSurveyCaseDto, UpsertSurveyOrderDto } from './survey.dto';

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
    description: ['單號由系統依日期自動編碼(`SV-YYYYMMDD-序號`)，不需傳入。', '', '所需權限：`SURVEY.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: UpsertSurveyOrderDto,
    examples: {
      dispute: {
        summary: '爭議調查',
        value: { TITLE: '臺灣大道路面爭議調查', REQUESTER: '示範市政府建設局', SURVEYOR_ID: 3, DUE_DATE: '2026-09-15', STATE: 'ISSUED' }
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
    description: ['一個調查點就是一次實地量測。`METHOD` 決定可信度，報告會標示出來。', '', '所需權限：`SURVEY.READ`'].join('\n')
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
      visual: { summary: '目視調查(尚未完成)', value: { ORDER_ID: 1, LNG: 120.6478, LAT: 24.1636, METHOD: 'VISUAL', ROAD_NAME: '中山路一段' } },
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
}
