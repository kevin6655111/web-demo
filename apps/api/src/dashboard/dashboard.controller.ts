import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { DashboardService } from './dashboard.service';
import { DailyCheckQueryDto, SettlementQueryDto } from './dashboard.dto';

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
  /** 每日上傳檢查 */
  @Get('dashboard/daily-check')
  @ApiOperation({
    summary: '每日上傳檢查',
    description: [
      '督導早上開的第一個畫面：昨天每一台車都有正常上傳嗎。',
      '',
      '**預設看昨天**：今天的資料還在進來，現在說「這台車今天只上傳三筆」沒有意義。',
      '',
      '`NOTE` 是結論，也是督導唯一會讀的欄位：',
      '- `未出車` —— 沒有案件也沒有軌跡，是調度問題',
      '- `有軌跡但沒有案件` —— 車出去了但判讀模型可能有問題',
      '- `照片可能缺件約 N 張` —— 案件有紀錄但檔案不在物件儲存上',
      '',
      '照片是**抽驗**的：每組最多抽 50 張問物件儲存，再用缺件率推估全體 ——',
      '逐筆全驗會讓一次結算跑上幾分鐘。',
      '',
      '資料由「每日檢查上傳狀態」排程每小時產生。所需權限：`DASHBOARD.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功；該日還沒檢查時回 warn' })
  @ApiCommonErrors()
  @RequireAction(ACTION.DASHBOARD.READ)
  async handleDailyCheck(@Query() dto: DailyCheckQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.dashboardService.getDailyCheck(dto, user.companyId);
  }

  /** 結算查詢 */
  @Get('dashboard/settlement')
  @ApiOperation({
    summary: '結算查詢(歷史區間)',
    description: [
      '讀每日結算表而不是即時算 —— 即時算要掃整月的軌跡點(每台車每天七千筆)，',
      '而這一支是報表與看板的歷史區間在用的。',
      '',
      '同時回傳巡查(里程、各破壞類型)與派工(施工中、已回報、完工、逾期)兩組數字，',
      '因為看板上它們永遠並排出現。`GROUP_BY` 可依日期、行政區或標案彙總。',
      '',
      '結算由「儀表板結算」排程每日產生，重算最近三天 ——',
      '派工單的狀態會隨時間變動(今天完工的單，派工日可能是三天前)。',
      '',
      '所需權限：`DASHBOARD.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功；區間內沒有結算時回 warn' })
  @ApiCommonErrors()
  @RequireAction(ACTION.DASHBOARD.READ)
  async handleSettlement(@Query() dto: SettlementQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.dashboardService.getSettlement(dto, user.companyId);
  }

}
