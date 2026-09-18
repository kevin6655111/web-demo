import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { FireBaseService } from './fire-base.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './fire-base.dto';
import type { DevicePlatform } from './entities/device-token.entity';

/**
 * 推播裝置註冊。
 *
 * 推播本身由系統各處主動觸發（派工、逾期、報表完成），不對外開放端點 ——
 * 可任意指定收件人的推播端點，等於給了任何登入者一支擴音器。
 */
@ApiTags('Push')
@ApiBearerAuth(API_AUTH)
@Controller('push')
export class FireBaseController {
  constructor(private readonly fireBaseService: FireBaseService) {}

  /** 註冊裝置 */
  @Post('device')
  @ApiOperation({
    summary: '註冊推播裝置',
    description: [
      '同一個權杖再次註冊時會改綁到目前的使用者 —— 裝置轉手或共用手機是現場的常態。',
      '',
      '未設定 FCM 憑證時仍可註冊：推播會進入記錄模式，',
      '「誰會收到這則通知」仍然驗證得到，而那正是推播最容易出錯的部分。',
      '',
      '不需額外權限（需已登入）。'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '已註冊' })
  @ApiCommonErrors({ badRequest: '權杖或平台格式錯誤' })
  async handleRegister(@Body() dto: RegisterDeviceDto, @User() user: AuthUser): Promise<HttpResult> {
    const device = await this.fireBaseService.register(
      user.uid,
      dto.TOKEN,
      dto.PLATFORM as DevicePlatform,
      dto.DEVICE_NAME
    );

    return HttpResponse.success({ message: '裝置已註冊', data: { ID: device.id } });
  }

  /** 停用裝置 */
  @Delete('device')
  @ApiOperation({
    summary: '停用推播裝置',
    description: [
      '標記為停用而非刪除，保留紀錄才能回答「這台裝置是什麼時候不再接收通知的」。',
      '',
      '不需額外權限（需已登入）。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已停用' })
  @ApiCommonErrors()
  async handleUnregister(@Body() dto: UnregisterDeviceDto): Promise<HttpResult> {
    await this.fireBaseService.deactivate(dto.TOKEN);

    return HttpResponse.success({ message: '裝置已停用' });
  }

  /** 我的裝置 */
  @Get('device')
  @ApiOperation({
    summary: '我註冊過的裝置',
    description: ['含已停用的，供使用者確認哪些裝置還會收到通知。', '', '不需額外權限（需已登入）。'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  async handleListDevices(@User() user: AuthUser): Promise<HttpResult> {
    const devices = await this.fireBaseService.listDevices(user.uid);

    return HttpResponse.successOrWarn({
      data: devices.map((d) => ({
        ID: d.id,
        PLATFORM: d.platform,
        DEVICE_NAME: d.deviceName ?? null,
        IS_ACTIVE: d.isActive,
        LAST_PUSHED_AT: d.lastPushedAt ?? null,
        CREATED_AT: d.createdAt
      })),
      warnMsg: '尚未註冊任何裝置'
    });
  }

  /** 推播涵蓋統計 */
  @Get('stats')
  @ApiOperation({
    summary: '推播涵蓋統計',
    description: ['各平台的有效裝置數，以及 FCM 憑證是否已設定。', '', '所需權限：`SYSTEM.AUDIT`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.SYSTEM.AUDIT)
  async handleStats(): Promise<HttpResult> {
    return HttpResponse.success({
      data: { CONFIGURED: this.fireBaseService.configured, BY_PLATFORM: await this.fireBaseService.stats() }
    });
  }
}
