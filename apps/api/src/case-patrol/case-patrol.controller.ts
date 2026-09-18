import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { CasePatrolService } from './case-patrol.service';
import {
  BatchUpdateStatusDto,
  CaseQueryDto,
  CaseStatsQueryDto,
  MileageQueryDto,
  NearbyQueryDto,
  UpdateCaseDto,
  UpdateCaseStatusDto
} from './case-patrol.dto';
import { UPDATE_STATUS_EXAMPLES } from './case-patrol.example';

@ApiTags('Case-Patrol')
@ApiBearerAuth(API_AUTH)
@Controller()
export class CasePatrolController {
  constructor(private readonly casePatrolService: CasePatrolService) {}

  /** 查詢案件 */
  @Get('patrol/case')
  @ApiOperation({
    summary: '查詢案件(分頁)',
    description: [
      '條件皆為選填，全部省略時回傳最新的案件。結果依發現時間新到舊排序。',
      '`SIZE` 上限 200 —— 要匯出全部請改用報表端點，那條路徑是非同步的，不會拖垮 API。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`data.ROWS` 為案件列，查無資料時 `status` 為 false' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetCases(@Query() dto: CaseQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getCases(dto, user.companyId);
  }

  /** 查詢附近案件 */
  @Get('patrol/case/nearby')
  @ApiOperation({
    summary: '查詢半徑內案件',
    description: [
      '以 PostGIS 的 `ST_DWithin` 查詢，距離單位是公尺，結果由近而遠排序、上限 200 筆。',
      '施工人員到場前先查一次，可以把附近的案件併成同一趟處理。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。半徑內無案件時 `status` 為 false' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetNearby(@Query() dto: NearbyQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getNearby(dto, user.companyId);
  }

  /** 更新案件狀態 */
  @Put('patrol/case/status')
  @ApiOperation({
    summary: '更新案件狀態',
    description: [
      '直接改狀態。**正常流程請走派工端點** —— 那會一併建立派工單與歷程；',
      '這支用於資料修正等例外情況。',
      '',
      '每次變更都會產生一個新版本，可在案件歷程中回溯與還原。',
      '',
      '所需權限：`CASE.UPDATE`'
    ].join('\n')
  })
  @ApiBody({ type: UpdateCaseStatusDto, examples: UPDATE_STATUS_EXAMPLES })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiCommonErrors({ notFound: '找不到該案件，或案件不屬於目前登入者的公司' })
  @Audit({ action: 'CASE', keys: ['ID', 'STATUS'] })
  @RequireAction(ACTION.CASE.UPDATE)
  async handleUpdateStatus(@Body() dto: UpdateCaseStatusDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.updateStatus(dto, user);
  }

  /** 更新案件欄位 */
  @Patch('patrol/case')
  @ApiOperation({
    summary: '更新案件欄位',
    description: [
      '修正類型、嚴重程度、尺寸、路名、地址或標案歸屬。',
      '',
      '每次更新都寫一個新版本(含變更前後的欄位差異)，',
      '所以「誰把面積改大了」在歷程上看得到 —— 這類欄位會影響計價。',
      '',
      '所需權限：`CASE.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpdateCaseDto,
    examples: {
      fixType: {
        summary: '複查後修正判定',
        value: { ID: 12, CRACK_TYPE: 'SUBSIDENCE', SEVERITY: 'HIGH', REMARK: '複查為路基下陷' }
      },
      fixArea: { summary: '修正面積與地址', value: { ID: 12, AREA_M2: 1.8, ADDRESS: '臺灣大道三段 99 號前' } }
    }
  })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiCommonErrors({ badRequest: '參數錯誤: 沒有帶任何要更新的欄位', notFound: '找不到該案件' })
  @Audit({ action: 'CASE', keys: ['ID', 'CRACK_TYPE', 'DEGREE', 'AREA'] })
  @RequireAction(ACTION.CASE.UPDATE)
  async handleUpdateCase(@Body() dto: UpdateCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.updateCase(dto, user);
  }

  /** 批次更新狀態 */
  @Put('patrol/case/status/batch')
  @ApiOperation({
    summary: '批次更新案件狀態',
    description: [
      '二篩是一次看幾十筆的工作 —— 一筆一次呼叫，網路來回的時間會比判斷本身還久。',
      '',
      '整批在同一個交易裡更新：部分成功的批次很難收拾，',
      '使用者也說不出「剛剛那五十筆有哪幾筆沒進去」。',
      '',
      '每一筆仍各自寫入歷程 —— 批次是操作方式，不是稽核上的一筆。',
      '',
      '所需權限：`CASE.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: BatchUpdateStatusDto,
    examples: {
      pass: { summary: '整批二篩通過', value: { IDS: [12, 13, 14], STATUS: 1 } },
      needRepair: { summary: '整批判定需修繕', value: { IDS: [12, 13], NEED_REPAIR: 1 } }
    }
  })
  @ApiResponse({ status: 200, description: '已更新，回傳成功筆數' })
  @ApiCommonErrors({ badRequest: '沒有指定要更新的狀態' })
  @Audit({ action: 'CASE', keys: ['IDS', 'STATUS', 'NEED_REPAIR'] })
  @RequireAction(ACTION.CASE.UPDATE)
  async handleBatchUpdateStatus(@Body() dto: BatchUpdateStatusDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.batchUpdateStatus(dto, user);
  }

  /** 案件統計 */
  @Get('patrol/case/stats')
  @ApiOperation({
    summary: '案件統計(多維度)',
    description: [
      '同一支端點支援六種分組：日 / 週 / 月 / 行政區 / 路名 / 破壞類型。',
      '',
      '合併成一支是因為問題其實只有一個 ——「案件集中在哪裡」，',
      '差別只在「哪裡」指的是時間還是空間。',
      '',
      '時間維度依時間排序(折線圖的 x 軸不能亂序)，其餘依數量排序。',
      '',
      '所需權限：`DASHBOARD.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.DASHBOARD.READ)
  async handleGetStats(@Query() dto: CaseStatsQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getStats(dto, user.companyId);
  }

  /** 可能重複的案件 */
  @Get('patrol/case/:ID/duplicate')
  @ApiOperation({
    summary: '可能重複回報的案件',
    description: [
      '同一個坑洞常被重複拍到 —— 車機今天拍一次、民眾用 APP 又報一次。',
      '它們的 `EXTERNAL_ID` 不同，去重機制擋不掉，但派工時應該併成一張單，',
      '否則會派兩班人去修同一個坑。',
      '',
      '判定：**同破壞類型 + 30 公尺內 + 前後 30 天 + 尚未完修**。',
      '只比座標的話，同一個路口不同時期的破壞會被誤判成同一件。',
      '',
      '回傳含距離(公尺)，前端直接顯示，不必自己用座標換算。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'ID', example: 12 })
  @ApiResponse({ status: 200, description: '查詢成功；沒有重複時 `status` 為 false' })
  @ApiCommonErrors({ notFound: '找不到該案件' })
  @RequireAction(ACTION.CASE.READ)
  async handleGetDuplicates(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getDuplicates(id, user.companyId);
  }

  /**
   * 案件詳情。
   *
   * **這條路由必須放在所有 `patrol/case/xxx` 之後** ——
   * `:ID` 會吃掉任何字串，放前面的話 `nearby` 與 `stats` 都會變成「找不到案件 nearby」。
   */
  /** 依案件編號查詢 */
  @Get('patrol/case/num/:CASE_NUM')
  @ApiOperation({
    summary: '依案件編號查詢單筆',
    description: [
      '業主與公文用的是案件編號而不是 id ——「DEMO01000123 這件修好了沒有」',
      '是最常被問的一句話，而承辦手上只有那個編號。',
      '',
      '編碼失敗或還沒編號的案件只有外部編號，這支端點兩者都查得到。',
      '',
      '**必須宣告在 `patrol/case/:ID` 之前** —— Nest 依宣告順序比對路由。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'CASE_NUM', example: 'DEMO01000123' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '查無此案件編號' })
  @RequireAction(ACTION.CASE.READ)
  async handleGetByCaseNum(@Param('CASE_NUM') caseNum: string, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getByCaseNum(caseNum, user.companyId);
  }

  /** 連續破壞警示 */
  @Get('patrol/case/alligator-warning')
  @ApiOperation({
    summary: '連續鱷魚狀裂縫警示',
    description: [
      '單獨一處龜裂是局部修補，**連續一整段**代表路基已經失效 ——',
      '那要整段刨鋪，是預算等級不同的工程。這個差別在逐筆的清單上看不出來，',
      '承辦要一件一件對座標才會發現。',
      '',
      '判定：同一輛車、相鄰兩筆距離不超過 10 公尺、序號連號或同號，且至少 2 筆。',
      '中間夾雜其他破壞類型不會中斷序列 —— 一段龜裂的路面上本來就會混著坑洞。',
      '',
      '`SPAN_M` 是群組頭尾的距離：整段刨鋪的估價要的是這個數字，不是筆數。',
      '',
      '查詢條件與案件清單相同。所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功；沒有連續群組時回 warn' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleAlligatorWarning(@Query() dto: CaseQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getAlligatorWarnings(dto, user.companyId);
  }

  /** 巡查里程統計 */
  @Get('patrol/mileage')
  @ApiOperation({
    summary: '巡查里程統計',
    description: [
      '依 (日期 × 車輛 × 行政區) 拆開 —— 請款是按行政區結算的，',
      '一台車一天跑過三個區，那一天的里程要分成三筆。',
      '',
      '**跟上一筆距離大於 5 公尺才計入**：車子停在紅燈前的兩分鐘會產生',
      '二十幾個幾乎重疊的點，不濾掉的話 GPS 的原地跳動會被算成里程。',
      '',
      '一趟行程的起點不與上一趟接續：中間那段是回廠的路，不是巡查里程。',
      '',
      '所需權限：`TRACK.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TRACK.READ)
  async handleMileage(@Query() dto: MileageQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getMileage(dto, user.companyId);
  }

  @Get('patrol/case/:ID')
  @ApiOperation({
    summary: '案件詳情',
    description: [
      '比清單多回三組東西：原始地址、車機軌跡檔位置，以及**三組狀態各自的異動者與時間**。',
      '',
      '清單不回這些是為了分頁速度 —— 但那正是承辦點進來要看的：',
      '「這個案件是誰篩的、誰改的、誰判定要修的」。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'ID', example: 12 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到該案件' })
  @RequireAction(ACTION.CASE.READ)
  async handleGetById(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.getCaseById(id, user.companyId);
  }
}
