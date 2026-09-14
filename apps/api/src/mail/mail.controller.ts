import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { MailService } from './mail.service';
import { MailQueryDto, SendTestMailDto } from './mail.dto';

/**
 * 郵件工作管理。
 *
 * 屬於維運介面而非業務功能：郵件由系統各處自動排入，
 * 這組端點回答的是「有沒有寄出、失敗的是哪幾封、能不能重送」。
 */
@ApiTags('Mail')
@ApiBearerAuth(API_AUTH)
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  /** 郵件工作清單 */
  @Get('job')
  @ApiOperation({
    summary: '郵件工作清單',
    description: [
      '依建立時間新到舊排列，可用 `STATE` 篩選。',
      '',
      '未設定 SMTP 時，郵件仍會完整排入並標記為已處理，',
      '狀態欄的 `LAST_ERROR` 會註明「未實際寄出」——',
      '流程走得完，而是否真的送達仍然分辨得出來。',
      '',
      '所需權限：`SYSTEM.AUDIT`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleList(@Query() dto: MailQueryDto): Promise<HttpResult> {
    return await this.mailService.list(dto.STATE, dto.LIMIT);
  }

  /** 郵件內容 */
  @Get('job/:ID')
  @ApiOperation({
    summary: '郵件完整內容',
    description: ['含 HTML 本文。未設定 SMTP 時，這裡就是實際的收件匣。', '', '所需權限：`SYSTEM.AUDIT`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到郵件工作' })
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleDetail(@Param('ID', ParseIntPipe) id: number): Promise<HttpResult> {
    return await this.mailService.detail(id);
  }

  /** 重送 */
  @Post('job/:ID/retry')
  @ApiOperation({
    summary: '重送郵件',
    description: [
      '重設為待處理並重新排入佇列。',
      '',
      '`ATTEMPTS` 不會歸零 —— 該欄位要回答的是「這封信總共試了幾次」。',
      '',
      '所需權限：`SYSTEM.AUDIT`'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '已重新排入佇列' })
  @ApiCommonErrors({ notFound: '找不到郵件工作' })
  @Audit({ action: 'MAIL', keys: ['ID'] })
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleRetry(@Param('ID', ParseIntPipe) id: number): Promise<HttpResult> {
    return await this.mailService.retry(id);
  }

  /** 刪除 */
  @Delete('job/:ID')
  @ApiOperation({
    summary: '刪除郵件工作',
    description: ['佇列中尚未執行的工作一併移除。', '', '所需權限：`SYSTEM.AUDIT`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '已刪除' })
  @ApiCommonErrors({ notFound: '找不到郵件工作' })
  @Audit({ action: 'MAIL', keys: ['ID'] })
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleRemove(@Param('ID', ParseIntPipe) id: number): Promise<HttpResult> {
    return await this.mailService.remove(id);
  }

  /** 寄出一封測試信 */
  @Post('test')
  @ApiOperation({
    summary: '寄出測試郵件',
    description: [
      '用於確認佇列與傳輸設定是否正常。內容取自既有樣板，不另外定義測試樣板 ——',
      '測試若走的是與正式不同的路徑，通過與否說明不了什麼。',
      '',
      '所需權限：`SYSTEM.AUDIT`'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '已排入佇列' })
  @ApiCommonErrors({ badRequest: '收件地址格式錯誤' })
  @Audit({ action: 'MAIL', keys: ['TO'] })
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleTest(@Body() dto: SendTestMailDto): Promise<HttpResult> {
    const job = await this.mailService.enqueue('PASSWORD_CHANGED', dto.TO, {
      account: dto.ACCOUNT ?? 'demo',
      changedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });

    return { status: true, code: 201, message: `已排入佇列，工作編號 #${job.id}`, data: { ID: job.id } };
  }
}
