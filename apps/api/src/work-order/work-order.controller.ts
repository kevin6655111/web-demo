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
import { WorkOrderService, type UploadedImage } from './work-order.service';
import { AddWorkOrderDto, DeleteImageDto, UpdateOrderStatusDto, UpdateWorkOrderDto, WorkOrderQueryDto } from './work-order.dto';
import { ADD_ORDER_EXAMPLES, UPDATE_STATUS_EXAMPLES } from './work-order.example';

/** 上傳欄位：每個照片類型一個欄位，ZIP 類型另外套壓縮檔規則 */
const IMAGE_FIELDS = IMAGE_TYPE_DEF.map((def) => ({
  name: def.type,
  maxCount: 1,
  ...(def.zip ? ZIP_RULE : IMAGE_RULE)
}));

@ApiTags('Work-Order')
@ApiBearerAuth(API_AUTH)
@Controller()
export class WorkOrderController {
  constructor(private readonly workOrderService: WorkOrderService) {}

  /** 建立派工單 */
  @Post('workorder')
  @ApiOperation({
    summary: '建立派工單',
    description: [
      '四種類型的必填欄位不同：',
      '',
      '- `PA` 刨除加封、`PB` 路基改善：自行發起的工程',
      '- `PC` AI 車巡、`PD` APP 巡查：從既有案件轉來，**必須帶來源案件 id**',
      '  否則會出現「修了但不知道在修什麼」的單',
      '',
      '`PB` 另外必填取樣資訊（`SAMPLE_TAKEN`；有取樣時還要 `SAMPLE_DATE` 與 `TEST_ITEM`）。',
      '',
      '單號由系統依「標案號 + 類型 + 年月 + 流水」自動編碼，從單號就看得出是哪個標案的第幾張。',
      '',
      '派工單、狀態、取樣資訊、來源案件的狀態都在同一個交易裡 ——',
      '只建了單卻沒改案件狀態的話，那個案件會被重複派工。',
      '',
      '所需權限：`WORK_ORDER.CREATE`'
    ].join('\n')
  })
  @ApiBody({ type: AddWorkOrderDto, examples: ADD_ORDER_EXAMPLES })
  @ApiResponse({ status: 201, description: '已建立，回傳 id 與單號' })
  @ApiCommonErrors({
    badRequest: '參數錯誤：欄位缺漏、型別錯誤，或未依類型帶必填欄位（PB 的取樣、PC 的來源案件）',
    notFound: '找不到標案',
    conflict: '來源案件已有派工單'
  })
  @Idempotent(300)
  @Audit({ action: 'WORK_ORDER', keys: ['TYPE', 'PRJ_ID', 'ADDRESS', 'WORKER_USER_ID'] })
  @RequireAction(ACTION.WORK_ORDER.CREATE)
  async handleCreate(@Body() dto: AddWorkOrderDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.workOrderService.create(dto, user, req.ip);
  }

  /** 更新派工單 */
  @Patch('workorder')
  @ApiOperation({
    summary: '更新派工單',
    description: [
      '修改地點、日期、施工人員、材料與尺寸、取樣資訊。',
      '',
      '**類型不可改**：PA 與 PB 的必填欄位不同，改類型等於換一張單，',
      '應該作廢重開而不是就地修改 —— 否則歷程會出現一張前後不一致的單。',
      '',
      '已完工的單不可修改。每次修改都寫入新版本。',
      '',
      '所需權限：`WORK_ORDER.UPDATE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '沒有帶任何要更新的欄位', notFound: '找不到派工單', conflict: '已完工的派工單不可修改' })
  @Audit({ action: 'WORK_ORDER', keys: ['ID', 'WORKER_USER_ID', 'MATERIAL'] })
  @RequireAction(ACTION.WORK_ORDER.UPDATE)
  async handleUpdate(@Body() dto: UpdateWorkOrderDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.workOrderService.update(dto, user, req.ip);
  }

  /** 更新狀態 */
  @Put('workorder/status')
  @ApiOperation({
    summary: '更新派工單狀態',
    description: [
      '0 待處理 → 1 施工中 → 2 已回報 → 3 已完工。退回時設回 0 並填 `REJECT_REASON`。',
      '',
      '另外收三個**動作碼**：`-1` 刪除、`8` 復原、`9` 撤回。',
      '它們不會被原樣寫進資料庫 —— 要先看這張單當前在哪裡才知道該寫什麼：',
      '',
      '- `9` 撤回：退一階。退到「待處理／施工中」這一段時，改由有沒有施工人員決定，',
      '  否則會出現一張沒有人卻標成施工中的單。',
      '- `-1` 刪除：**已回報或已完工不允許**，要先撤回 —— 否則已經回報過的事實會被靜靜抹掉。',
      '  刪除時來源案件退回「觀察中」，可以重新派工。',
      '- `8` 復原：回到這張單歷程上的上一個不同狀態；被一起刪掉的來源案件也會救回來。',
      '',
      '**完工(3)會檢查必要照片齊不齊** —— 缺照片的完工單在驗收時會被退回，',
      '與其讓它一路走到驗收才發現，不如在這裡就擋住。各類型要求的照片見照片端點。',
      '',
      '完工時來源案件標記為已處理；退回時放回「觀察中」，讓它重新進入待派工。',
      '',
      '所需權限：`WORK_ORDER.UPDATE`（驗收另需 `WORK_ORDER.ACCEPT`；撤回與復原需 `WORK_ORDER.APPROVE`、刪除需 `WORK_ORDER.DELETE`）'
    ].join('\n')
  })
  @ApiBody({ type: UpdateOrderStatusDto, examples: UPDATE_STATUS_EXAMPLES })
  @ApiResponse({ status: 200, description: '狀態已更新' })
  @ApiCommonErrors({ badRequest: '缺少必要照片，無法標記完工', notFound: '找不到派工單' })
  @Audit({ action: 'WORK_ORDER', keys: ['ID', 'STATUS', 'REJECT_REASON'] })
  @RequireAction(ACTION.WORK_ORDER.UPDATE)
  @RequireActionByField('STATUS', {
    '-1': ACTION.WORK_ORDER.DELETE,
    '3': ACTION.WORK_ORDER.ACCEPT,
    [String(WORK_ORDER_ACTION.RESTORE)]: ACTION.WORK_ORDER.APPROVE,
    [String(WORK_ORDER_ACTION.WITHDRAW)]: ACTION.WORK_ORDER.APPROVE
  })
  async handleUpdateStatus(@Body() dto: UpdateOrderStatusDto, @User() user: AuthUser, @Req() req: Request): Promise<HttpResult> {
    return await this.workOrderService.updateStatus(dto, user, req.ip);
  }

  /**
   * 上傳照片。
   *
   * multipart 一次可傳多個類型；每個照片類型一個欄位名。
   */
  @Post('workorder/image')
  @ApiOperation({
    summary: '上傳派工單照片',
    description: [
      '`multipart/form-data`，**欄位名就是照片類型**（`IMG_BEFORE`、`IMG_AFTER`…），一次可傳多種。',
      '',
      '**同一類型只留一張**：驗收要的是「這個階段的照片」，不是同一階段的二十張。',
      '重複上傳會覆寫而不是長出第二筆 —— 現場重拍是常態。要留全部就用 `_ZIP` 類型。',
      '',
      '限制：單檔 20MB；一般類型只收 jpg/png/heic/webp，`_ZIP` 類型只收 zip。',
      '副檔名與 MIME 都檢查 —— 兩者都能偽造，但同時偽造比較難。',
      '',
      '`IMAGE_DELETE` 帶類型的 JSON 陣列可同時刪除既有照片，物件也一併刪掉不留孤兒檔。',
      '',
      '所需權限：`WORK_ORDER.UPDATE`'
    ].join('\n')
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ID: { type: 'integer', example: 3, description: '派工單 id' },
        IMAGE_DELETE: { type: 'string', example: '["IMG_DURING"]', description: '要刪除的照片類型' },
        ...Object.fromEntries(IMAGE_TYPE_DEF.map((d) => [d.type, { type: 'string', format: 'binary', description: d.name }]))
      },
      required: ['ID']
    }
  })
  @ApiResponse({ status: 201, description: '上傳完成，回傳成功的類型清單' })
  @ApiCommonErrors({ badRequest: '檔案格式或大小不符；或欄位名不是有效的照片類型', notFound: '找不到派工單' })
  @UploadFields(IMAGE_FIELDS, { maxSizeMB: 20 })
  @Audit({ action: 'WORK_ORDER', keys: ['ID'] })
  @RequireAction(ACTION.WORK_ORDER.UPDATE)
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

    return await this.workOrderService.uploadImages(id, flat, deleteTypes, user);
  }

  /** 照片清單 */
  @Get('workorder/:ID/image')
  @ApiOperation({
    summary: '派工單照片清單',
    description: [
      '回傳已上傳的照片（含 5 分鐘有效的下載網址）、該類型要求的照片，以及**還缺哪些**。',
      '',
      '網址每次重新簽發，不要存起來重複使用。',
      '',
      '所需權限：`WORK_ORDER.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到派工單' })
  @RequireAction(ACTION.WORK_ORDER.READ)
  async handleListImages(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.workOrderService.listImages(id, user.companyId);
  }

  /** 刪除照片 */
  @Delete('workorder/image')
  @ApiOperation({ summary: '刪除派工單照片', description: ['物件儲存上的檔案一併刪除。', '', '所需權限：`WORK_ORDER.UPDATE`'].join('\n') })
  @ApiResponse({ status: 200, description: '已刪除' })
  @ApiCommonErrors({ notFound: '找不到該照片' })
  @Audit({ action: 'WORK_ORDER', keys: ['ID', 'IMG_TYPE'] })
  @RequireAction(ACTION.WORK_ORDER.UPDATE)
  async handleDeleteImage(@Body() dto: DeleteImageDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.workOrderService.deleteImage(dto, user);
  }

  /** 派工單清單 */
  @Get('workorder')
  @ApiOperation({
    summary: '查詢派工單',
    description: [
      '條件皆為選填。`OVERDUE` 只看逾期未完工的，`MISSING_IMAGE` 只看缺必要照片的 ——',
      '這兩個是驗收前最常用的篩選。',
      '',
      '所需權限：`WORK_ORDER.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.WORK_ORDER.READ)
  async handleList(@Query() dto: WorkOrderQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.workOrderService.list(dto, user.companyId);
  }

  /** 派工單詳情 */
  @Get('workorder/:ID')
  @ApiOperation({
    summary: '派工單詳情',
    description: ['含起訖點座標、取樣資訊、照片清單與缺件、狀態變更者與時間。', '', '所需權限：`WORK_ORDER.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到派工單' })
  @RequireAction(ACTION.WORK_ORDER.READ)
  async handleGetById(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.workOrderService.getById(id, user.companyId);
  }
}
