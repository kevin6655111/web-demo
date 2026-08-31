import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { RealtimeService } from './realtime.service';
import { CaseGateway } from './case.gateway';

/**
 * 即時狀態的 HTTP 介面。
 *
 * 為什麼有了 WebSocket 還要這幾支：頁面剛載入時需要「現在的樣子」，
 * 而 WebSocket 只送「之後的變化」。兩者少了任何一邊，
 * 使用者都會看到不完整的畫面 —— 這是即時系統最常見的漏洞。
 */
@ApiTags('Realtime')
@ApiBearerAuth('bearer')
@Controller()
export class RealtimeController {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly caseGateway: CaseGateway
  ) {}

  /** 線上人員 */
  @Get('realtime/presence')
  @ApiOperation({
    summary: '線上人員',
    description: ['目前有 WebSocket 連線的人，以及各自正在看哪個案件。', '狀態有 60 秒 TTL，來源是 Redis。', '', '所需權限：`CASE.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetPresence(@User() user: AuthUser): Promise<HttpResult> {
    return HttpResponse.success({ data: await this.realtimeService.listPresence(user.companyId) });
  }

  /** 車輛與人員位置 */
  @Get('realtime/fleet')
  @ApiOperation({
    summary: '車輛/人員即時位置',
    description: [
      '最近兩分鐘內回報過位置的車機與手機。',
      '位置只存 Redis 且有 TTL —— 它只有「現在」有價值，歷史軌跡是另一回事。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetFleet(@User() user: AuthUser): Promise<HttpResult> {
    return HttpResponse.success({ data: await this.realtimeService.listFleet(user.companyId) });
  }

  /** 案件討論訊息 */
  @Get('realtime/case/:ID/messages')
  @ApiOperation({
    summary: '案件討論訊息',
    description: ['依時間正序回傳最近的討論訊息。', 'WebSocket 進房時也會自動回補，這支給不開 WebSocket 的情境用。', '', '所需權限：`CASE.READ`'].join('\n')
  })
  @ApiQuery({ name: 'LIMIT', required: false, example: 50 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetMessages(@Param('ID', ParseIntPipe) id: number, @Query('LIMIT') limit?: string): Promise<HttpResult> {
    const take = Math.min(Number(limit) || 50, 200);
    return HttpResponse.successOrWarn({ data: await this.realtimeService.getRecentMessages(id, take), warnMsg: '尚無討論訊息' });
  }

  /** WebSocket 連線統計 */
  @Get('realtime/stats')
  @ApiOperation({
    summary: 'WebSocket 連線統計',
    description: ['目前這個 api 實例握有的連線數。多實例部署時，各實例的數字要分開看。', '', '所需權限：`DASHBOARD.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.DASHBOARD.READ)
  handleGetStats(): HttpResult {
    return HttpResponse.success({ data: this.caseGateway.getStats() });
  }
}
