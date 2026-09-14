import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Req } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { CoreService } from './core.service';
import { UpsertAnnouncementDto } from './core.dto';

@ApiTags('Core')
@ApiBearerAuth(API_AUTH)
@Controller()
export class CoreController {
  constructor(private readonly coreService: CoreService) {}

  /** 代碼表 */
  @Get('core/code')
  @ApiOperation({
    summary: '代碼表',
    description: [
      '一次回傳所有下拉選單需要的代碼與中文標籤。',
      '',
      '前端不該自己維護一份中文對照 —— 那份一定會過期。',
      '後端新增一個破壞類型時，前端的選單應該自己多一個選項。',
      '',
      '`ORDER` 保留了原始順序：狀態的排列有意義(新報 → 派工 → 完修)，不該被字母排序打亂。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  handleGetCodeTables(): HttpResult {
    return this.coreService.getCodeTables();
  }

  /** 公告 */
  @Get('core/announcement')
  @ApiOperation({
    summary: '生效中的公告',
    description: [
      '停機維護、車機韌體更新、颱風停工 —— 只發群組訊息的話，沒看到的人就是沒看到。',
      '',
      '過期的公告自動不再回傳，不需要有人記得去關掉。置頂的排最前面。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  async handleGetAnnouncements(@User() user: AuthUser): Promise<HttpResult> {
    return await this.coreService.getAnnouncements(user.companyId);
  }

  /** 發布公告 */
  @Post('core/announcement')
  @ApiOperation({
    summary: '發布或更新公告',
    description: ['帶 `ID` 是更新。不帶 `START_AT` 表示立即生效。', '', '所需權限：`ACCOUNT.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: UpsertAnnouncementDto,
    examples: {
      maintenance: {
        summary: '維護公告',
        value: {
          TITLE: '9/5 系統維護公告',
          BODY: '9/5 22:00–24:00 進行資料庫維護，期間車機上傳會暫存於本機，恢復後自動補送。',
          LEVEL: 'WARNING',
          START_AT: '2026-09-01T00:00:00+08:00',
          END_AT: '2026-09-06T00:00:00+08:00',
          PINNED: true
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已發布或更新' })
  @ApiCommonErrors({ notFound: '找不到該公告' })
  @Audit({ action: 'ANNOUNCEMENT', keys: ['ID', 'TITLE', 'LEVEL'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleUpsertAnnouncement(@Body() dto: UpsertAnnouncementDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.coreService.upsertAnnouncement(dto, user);
  }

  /** 刪除公告 */
  @Delete('core/announcement/:ID')
  @ApiOperation({ summary: '刪除公告', description: ['所需權限：`ACCOUNT.UPDATE`'].join('\n') })
  @ApiResponse({ status: 200, description: '已刪除' })
  @ApiCommonErrors({ notFound: '找不到該公告' })
  @Audit({ action: 'ANNOUNCEMENT', keys: [] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleDeleteAnnouncement(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.coreService.deleteAnnouncement(id, user.companyId);
  }

  /**
   * 圖形驗證碼。
   *
   * 連續登入失敗數次後才要求 —— 一開始就要求驗證碼會拖慢每一次正常登入，
   * 而正常登入佔了絕大多數。答案存在 session 裡，不回傳給前端。
   */
  @Get('captcha')
  @ApiExcludeEndpoint()
  handleGetCaptcha(@Req() req: Request & { session?: Record<string, unknown> }): HttpResult {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      background: '#111928',
      // 排除易混淆的字元：0/O、1/l 在圖片裡分不出來，只會讓人重試
      ignoreChars: '0oO1ilI',
      width: 140,
      height: 46
    });

    if (req.session) req.session.captcha = captcha.text.toLowerCase();

    return HttpResponse.success({ data: { SVG: captcha.data } });
  }
}
