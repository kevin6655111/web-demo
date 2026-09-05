import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('bearer')
@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** 儀表板總覽 */
  @Get('dashboard/overview')
  @ApiOperation({
    summary: '儀表板總覽',
    description: [
      '一次回傳看板需要的六個區塊：KPI、近 14 日趨勢、破壞類型分布、熱區路段、逾期派工單、最新案件。',
      '',
      '**整包快取 60 秒**：看板通常整天掛著刷新，沒必要讓每次刷新都打六個聚合查詢。',
      '`data.CACHED` 會告訴你這次是不是取自快取。',
      '',
      '所需權限：`DASHBOARD.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.DASHBOARD.READ)
  async handleOverview(@User() user: AuthUser): Promise<HttpResult> {
    return await this.dashboardService.getOverview(user.companyId);
  }
}
