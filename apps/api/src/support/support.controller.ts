import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { SupportService } from './support.service';
import { OpenThreadDto, SendMessageDto, ThreadQueryDto, UpdateThreadDto } from './support.dto';

@ApiTags('Support')
@ApiBearerAuth(API_AUTH)
@Controller()
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /** 開啟客服對話 */
  @Post('support/thread')
  @ApiOperation({
    summary: '開啟客服對話',
    description: [
      '建立一條客服對話並送出第一則訊息。',
      '',
      '**一位使用者同時只有一條開啟中的對話** —— 已經有的話會接續，',
      '回應的 `REUSED` 會告訴你是不是接續既有對話。',
      '現場人員遇到問題時要的是「有人回我」，不是「開一張新單」。',
      '',
      '所有登入者都能開啟，不需額外權限。'
    ].join('\n')
  })
  @ApiBody({
    type: OpenThreadDto,
    examples: {
      device: {
        summary: '車機問題',
        value: { SUBJECT: '車機無法上傳案件', CATEGORY: 'DEVICE', BODY: 'DEMO-001 今天早上開始一直顯示上傳失敗' }
      },
      account: {
        summary: '帳號問題',
        value: { SUBJECT: '同事帳號被鎖定', CATEGORY: 'ACCOUNT', BODY: '林師傅連續輸錯密碼被鎖，能否解鎖' }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或接續既有對話' })
  @ApiCommonErrors()
  @Audit({ action: 'SUPPORT', keys: ['SUBJECT', 'CATEGORY'] })
  async handleOpenThread(@Body() dto: OpenThreadDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.openThread(dto, user);
  }

  /** 我的對話 */
  @Get('support/thread/mine')
  @ApiOperation({
    summary: '我的客服對話',
    description: ['依時間新到舊回傳自己開過的對話與未讀數。', '', '所有登入者可用。'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  async handleMyThreads(@User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.myThreads(user);
  }

  /** 客服待處理清單 */
  @Get('support/thread')
  @ApiOperation({
    summary: '客服對話清單',
    description: [
      '**未指派的排最前面** —— 那些是還沒有人接的，也是最可能被漏掉的。',
      '',
      '所需權限：`SUPPORT.AGENT`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SUPPORT.AGENT)
  async handleListThreads(@Query() dto: ThreadQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.listThreads(dto, user);
  }

  /** 讀取對話訊息 */
  @Get('support/thread/:ID/message')
  @ApiOperation({
    summary: '讀取對話訊息',
    description: [
      '讀取後會清掉自己這一側的未讀數 —— 使用者與客服的未讀是分開算的。',
      '',
      '發問者本人或客服可讀。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到該對話' })
  async handleGetMessages(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.getMessages(id, user, user.actions.includes(ACTION.SUPPORT.AGENT));
  }

  /** 送出訊息 */
  @Post('support/message')
  @ApiOperation({
    summary: '送出客服訊息',
    description: [
      '訊息會即時推播給對方(WebSocket 的 `support` 頻道)。',
      '',
      '客服回話時會自動接手這條對話 —— 讓「誰在處理」不需要額外一個動作。',
      '',
      '發問者本人或客服可送。'
    ].join('\n')
  })
  @ApiBody({
    type: SendMessageDto,
    examples: { reply: { summary: '客服回覆', value: { THREAD_ID: 1, BODY: '收到，我先查一下車機的連線紀錄' } } }
  })
  @ApiResponse({ status: 201, description: '已送出' })
  @ApiCommonErrors({ notFound: '找不到該對話' })
  async handleSendMessage(@Body() dto: SendMessageDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.sendMessage(dto, user, user.actions.includes(ACTION.SUPPORT.AGENT));
  }

  /** 接手或結案 */
  @Put('support/thread')
  @ApiOperation({
    summary: '接手或變更對話狀態',
    description: ['`TAKE` 為 true 表示把這條對話接手過來。', '', '所需權限：`SUPPORT.AGENT`'].join('\n')
  })
  @ApiBody({
    type: UpdateThreadDto,
    examples: {
      take: { summary: '接手', value: { ID: 1, TAKE: true } },
      resolve: { summary: '標記已解決', value: { ID: 1, STATE: 'RESOLVED' } }
    }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ notFound: '找不到該對話' })
  @Audit({ action: 'SUPPORT', keys: ['ID', 'STATE', 'TAKE'] })
  @RequireAction(ACTION.SUPPORT.AGENT)
  async handleUpdateThread(@Body() dto: UpdateThreadDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.supportService.updateThread(dto, user);
  }
}
