import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { Idempotent } from '@decorators/idempotent.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { CasePatrolService } from './case-patrol.service';
import {
  AddCaseDto,
  BatchUpdateStatusDto,
  CaseQueryDto,
  CaseStatsQueryDto,
  NearbyQueryDto,
  UpdateCaseDto,
  UpdateCaseStatusDto
} from './case-patrol.dto';
import { ADD_CASE_EXAMPLES, UPDATE_STATUS_EXAMPLES } from './case-patrol.example';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description: '去重鍵，建議直接用案件外部編號。同一把 key 重送會回放第一次的結果，不會重複建立案件',
  schema: { type: 'string', example: 'TXG-20260828-000123' }
} as const;

@ApiTags('Case-Patrol')
@ApiBearerAuth(API_AUTH)
@Controller()
export class CasePatrolController {
  constructor(private readonly casePatrolService: CasePatrolService) {}

  /** 新增巡查案件(車機/App 上傳) */
  @Post('patrol/case')
  @ApiOperation({
    summary: '新增巡查案件',
    description: [
      '車機或手機 App 上傳偵測到的路面破壞。',
      '',
      '**重送安全**：上游常在收不到回應時自動重送，本端點有三層去重 ——',
      '`Idempotency-Key` 表頭、佇列的工作編號、以及 `EXTERNAL_ID` 的資料庫唯一鍵。',
      '重複遞送會回傳既有案件的 `ID` 並帶 `DUPLICATED: true`，HTTP 狀態仍是成功。',
      '',
      '**非同步後續**：路名由 worker 行程稍後補上，因此剛建立的案件 `ROAD_NAME` 會是 null。',
      '',
      '所需權限：`CASE.CREATE`'
    ].join('\n')
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiBody({ type: AddCaseDto, examples: ADD_CASE_EXAMPLES })
  @ApiResponse({ status: 201, description: '建立成功。`data.DUPLICATED` 為 true 表示這是重複遞送，未新增資料' })
  @ApiCommonErrors({ conflict: '相同 Idempotency-Key 用於不同內容，或前一筆相同請求仍在處理中' })
  @Idempotent(600)
  @Audit({ action: 'CASE', keys: ['EXTERNAL_ID', 'CRACK_TYPE', 'DETECTED_AT'] })
  @RequireAction(ACTION.CASE.CREATE)
  async handleAddCase(@Body() dto: AddCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.addCase(dto, user);
  }

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
      fixType: { summary: '複查後修正判定', value: { ID: 12, CRACK_TYPE: 'SUBSIDENCE', SEVERITY: 'HIGH', REMARK: '複查為路基下陷' } },
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
