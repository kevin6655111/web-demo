import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UploadedFiles } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { Idempotent } from '@decorators/idempotent.decorator';
import { IMAGE_RULE, UploadFields, ZIP_RULE } from '@decorators/upload.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { RequireActionByField } from '@decorators/permission-by-field.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { IMAGE_TYPE_DEF, WORK_ORDER_ACTION } from '@road-patrol/shared';
import { MaintenanceService } from './maintenance.service';
import type { UploadedImage } from '@/work-order/work-order.service';
import {
  AddMaintenanceDto,
  DeleteMaintenanceImageDto,
  MaintenanceQueryDto,
  UpdateMaintenanceDto,
  UpdateMaintenanceStatusDto
} from './maintenance.dto';
import { ADD_MAINTENANCE_EXAMPLES, MAINTENANCE_STATUS_EXAMPLES } from './maintenance.example';

/** 上傳欄位：每個照片類型一個欄位名，ZIP 類型另外套壓縮檔規則 */
const IMAGE_FIELDS = IMAGE_TYPE_DEF.map((def) => ({
  name: def.type,
  maxCount: 1,
  ...(def.zip ? ZIP_RULE : IMAGE_RULE)
}));

/**
 * 巡查單 API。
 *
 * 與派工單分開一組端點而不是共用：兩者的必填欄位、狀態流程、
 * 誰能改都不一樣 —— 共用的話每支端點都要先問「這是哪一種單」。
 */
@ApiTags('Maintenance')
@ApiBearerAuth(API_AUTH)
@Controller()
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /** 建立巡查單 */
  @Post('maintenance')
  @ApiOperation({
    summary: '建立巡查單',
    description: [
      '兩種類型：',
      '',
      '- `RA` 巡查：只記錄「看到什麼」',
      '- `RB` 巡修：當場就修掉了，**必填 `MATERIAL`** —— 修掉了卻沒寫用什麼修，計價時無從對帳',
      '',
      '單號由系統依「標案號 + 類型 + 年月 + 流水」自動編碼，與派工單同一套規則。',
      '破壞類型是坑洞時，會自動配一個標案內連號的坑洞編號（業主的坑洞管制表用它對帳）。',
      '',
      '主表、狀態、巡修內容在同一個交易裡 —— 只建了主表卻沒有狀態列的話，',
      '這張單在列表上會沒有狀態，而且永遠無法被批次操作選中。',
      '',
      '所需權限：`MAINTENANCE.CREATE`'
    ].join('\n')
  })
  @ApiBody({ type: AddMaintenanceDto, examples: ADD_MAINTENANCE_EXAMPLES })
  @ApiResponse({ status: 201, description: '已建立，回傳 id 與單號' })
  @ApiCommonErrors({ badRequest: '參數錯誤：欄位缺漏、型別錯誤，或 RB 未帶 MATERIAL', notFound: '找不到標案' })
  @Idempotent(300)
  @Audit({ action: 'MAINTENANCE', keys: ['TYPE', 'PRJ_ID', 'ADDRESS', 'DTYPE'] })
  @RequireAction(ACTION.MAINTENANCE.CREATE)
  async handleCreate(@Body() dto: AddMaintenanceDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.maintenanceService.create(dto, user, req.ip);
  }

  /** 更新巡查單 */
  @Patch('maintenance')
  @ApiOperation({
    summary: '更新巡查單',
    description: [
      '**類型可以改**（與派工單不同）：巡查員常是先開 `RA`，材料到了才當場補起來變成 `RB`。',
      '改回 `RA` 時巡修欄位會一併移除 —— 留著會變成「一張沒修過的單上寫著用了幾包冷瀝青」。',
      '',
      '破壞類型進出「坑洞」時，坑洞編號會跟著發或收。',
      '破壞面積由長寬算出，不接受前端自己送。',
      '',
      '已刪除的單不可修改，要先復原。每次修改都寫入新版本。',
      '',
      '所需權限：`MAINTENANCE.UPDATE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '沒有帶任何要更新的欄位', notFound: '找不到巡查單', conflict: '已刪除的巡查單不可修改' })
  @Audit({ action: 'MAINTENANCE', keys: ['ID', 'TYPE', 'DTYPE', 'MATERIAL'] })
  @RequireAction(ACTION.MAINTENANCE.UPDATE)
  async handleUpdate(@Body() dto: UpdateMaintenanceDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.maintenanceService.update(dto, user, req.ip);
  }

  /** 批次更新狀態 */
  @Put('maintenance/status')
  @ApiOperation({
    summary: '批次更新巡查單狀態（含刪除與復原）',
    description: [
      '`-1` 已刪除 / `0` 待確認 / `1` 觀察中 / `2` 已派工；`8` 為復原。',
      '',
      '**一次收一組 id**：一趟巡查會開十幾張單，逐張按十幾次沒有人會做。',
      '不能改的那幾筆會被跳過並附上原因，而不是整批失敗 ——',
      '整批失敗的話，使用者要自己猜是哪一筆擋住了，再把其餘的送一次。',
      '',
      '刪除的限制：只有「沒有活著的派工單」時才可刪。派工單已回報或完工的，',
      '要先撤回並刪除派工單 —— 否則會留下一張「不知道在修什麼」的孤兒單。',
      '',
      '復原是回到**這張單自己歷程上的上一個不同狀態**，不是固定回到待確認。',
      '',
      '訊息以 `\\n` 分行，前端要用 `white-space: pre-line` 呈現。',
      '',
      '所需權限：`MAINTENANCE.UPDATE`（刪除另需 `MAINTENANCE.DELETE`、復原另需 `MAINTENANCE.APPROVE`）'
    ].join('\n')
  })
  @ApiBody({ type: UpdateMaintenanceStatusDto, examples: MAINTENANCE_STATUS_EXAMPLES })
  @ApiResponse({ status: 200, description: '已更新；有跳過的筆數時回 warn' })
  @ApiCommonErrors({ badRequest: '未指定要更新的巡查單', notFound: '找不到巡查單' })
  @Audit({ action: 'MAINTENANCE', keys: ['ID', 'STATUS'] })
  @RequireAction(ACTION.MAINTENANCE.UPDATE)
  @RequireActionByField('STATUS', {
    '-1': ACTION.MAINTENANCE.DELETE,
    [String(WORK_ORDER_ACTION.RESTORE)]: ACTION.MAINTENANCE.APPROVE
  })
  async handleUpdateStatus(@Body() dto: UpdateMaintenanceStatusDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.maintenanceService.updateStatus(dto, user, req.ip);
  }

  /** 上傳照片 */
  @Post('maintenance/image')
  @ApiOperation({
    summary: '上傳巡查單照片',
    description: [
      '`multipart/form-data`，**欄位名就是照片類型**（`IMG` 現況、`IMG_BEFORE`／`IMG_AFTER` 修補前後）。',
      '',
      '同一類型只留一張，重複上傳是覆寫 —— 現場重拍是常態。',
      '限制：單檔 20MB；一般類型只收 jpg/png/heic/webp，`_ZIP` 類型只收 zip。',
      '',
      '`IMAGE_DELETE` 帶類型的 JSON 陣列可同時刪除既有照片，物件一併刪掉不留孤兒檔。',
      '',
      '所需權限：`MAINTENANCE.UPDATE`'
    ].join('\n')
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ID: { type: 'integer', example: 5, description: '巡查單 id' },
        IMAGE_DELETE: { type: 'string', example: '["IMG_AFTER"]', description: '要刪除的照片類型' },
        ...Object.fromEntries(IMAGE_TYPE_DEF.map((d) => [d.type, { type: 'string', format: 'binary', description: d.name }]))
      },
      required: ['ID']
    }
  })
  @ApiResponse({ status: 201, description: '上傳完成，回傳成功的類型清單' })
  @ApiCommonErrors({ badRequest: '檔案格式或大小不符；或欄位名不是有效的照片類型', notFound: '找不到巡查單' })
  @UploadFields(IMAGE_FIELDS, { maxSizeMB: 20 })
  @Audit({ action: 'MAINTENANCE', keys: ['ID'] })
  @RequireAction(ACTION.MAINTENANCE.UPDATE)
  async handleUploadImages(
    @Body('ID', ParseIntPipe) id: number,
    @Body('IMAGE_DELETE') imageDelete: string | undefined,
    @UploadedFiles() files: Record<string, UploadedImage[]>,
    @User() user: AuthUser
  ): Promise<HttpResult> {
    const flat = Object.values(files ?? {}).flat();

    // 前端可能送字串陣列或逗號字串，兩種都吃；解析失敗就當作沒有要刪
    let deleteTypes: string[] = [];
    try {
      deleteTypes = imageDelete ? JSON.parse(imageDelete) : [];
    } catch {
      deleteTypes = imageDelete ? imageDelete.split(',').map((s) => s.trim()).filter(Boolean) : [];
    }

    return await this.maintenanceService.uploadImages(id, flat, deleteTypes, user);
  }

  /** 照片清單 */
  @Get('maintenance/:ID/image')
  @ApiOperation({
    summary: '巡查單照片清單',
    description: [
      '回傳已上傳的照片（含 5 分鐘有效的下載網址）、該類型要求的照片，以及**還缺哪些**。',
      '',
      '`RB` 必須有修補前後兩張，否則「當場修掉了」這件事沒有任何憑據。',
      '',
      '所需權限：`MAINTENANCE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到巡查單' })
  @RequireAction(ACTION.MAINTENANCE.READ)
  async handleListImages(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.maintenanceService.listImages(id, user.companyId);
  }

  /** 刪除照片 */
  @Delete('maintenance/image')
  @ApiOperation({ summary: '刪除巡查單照片', description: ['物件儲存上的檔案一併刪除。', '', '所需權限：`MAINTENANCE.UPDATE`'].join('\n') })
  @ApiResponse({ status: 200, description: '已刪除' })
  @ApiCommonErrors({ notFound: '找不到該照片' })
  @Audit({ action: 'MAINTENANCE', keys: ['ID', 'IMG_TYPE'] })
  @RequireAction(ACTION.MAINTENANCE.UPDATE)
  async handleDeleteImage(@Body() dto: DeleteMaintenanceImageDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.maintenanceService.deleteImage(dto, user);
  }

  /** 巡查單清單 */
  @Get('maintenance')
  @ApiOperation({
    summary: '查詢巡查單',
    description: [
      '條件皆為選填。`NO_ORDER` 只看還沒開出派工單的 —— 這就是待派工清單，',
      '原本開過但已被刪掉的派工單也算在內。',
      '',
      '每一列都帶該單的派工單編號與狀態：列表上最常被問的就是「這張派了沒」。',
      '',
      '所需權限：`MAINTENANCE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.MAINTENANCE.READ)
  async handleList(@Query() dto: MaintenanceQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.maintenanceService.list(dto, user.companyId);
  }

  /** 巡查單詳情 */
  @Get('maintenance/:ID')
  @ApiOperation({
    summary: '巡查單詳情',
    description: ['含座標、巡修內容、照片清單與缺件、派工單狀態、狀態變更者與時間。', '', '所需權限：`MAINTENANCE.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到巡查單' })
  @RequireAction(ACTION.MAINTENANCE.READ)
  async handleGetById(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.maintenanceService.getById(id, user.companyId);
  }
}
