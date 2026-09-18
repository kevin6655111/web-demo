import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { PatrolSettingService } from './patrol-setting.service';
import { CoverageQueryDto, PlanQueryDto, UpsertPlanDto } from './patrol-setting.dto';

@ApiTags('Patrol-Setting')
@ApiBearerAuth(API_AUTH)
@Controller()
export class PatrolSettingController {
  constructor(private readonly patrolSettingService: PatrolSettingService) {}

  /** 巡查計畫清單 */
  @Get('patrol/plan')
  @ApiOperation({
    summary: '巡查計畫清單',
    description: [
      '契約通常寫「每條路每週至少巡一次」，所以系統要知道兩件事：',
      '該巡哪些路(路線幾何)、多久巡一次(頻率)。有了這兩者才算得出覆蓋率。',
      '',
      '所需權限：`PROJECT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.PROJECT.READ)
  async handleList(@Query() dto: PlanQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.patrolSettingService.list(dto, user.companyId);
  }

  /** 巡查路線圖層 */
  @Get('patrol/plan/layer')
  @ApiOperation({
    summary: '巡查路線圖層(GeoJSON LineString)',
    description: ['給地圖疊在軌跡之上，一眼看出哪一段沒走到。', '', '所需權限：`PROJECT.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.PROJECT.READ)
  async handleGetLayer(@Query() dto: PlanQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.patrolSettingService.getLayer(dto, user.companyId);
  }

  /** 新增或更新計畫 */
  @Post('patrol/plan')
  @ApiOperation({
    summary: '新增或更新巡查計畫',
    description: [
      '帶 `ID` 是更新，不帶是新增。',
      '',
      '**路線長度由資料庫計算**，不採用前端傳來的數字 ——',
      '不同投影下算出來的公里數會差好幾個百分點，而這個數字會進計費。',
      '',
      '所需權限：`PROJECT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpsertPlanDto,
    examples: {
      weekly: {
        summary: '主幹道週巡',
        value: {
          CODE: 'PLAN-A-001',
          NAME: '市區主幹道週巡',
          FREQUENCY: 'WEEKLY',
          ROUTE: [
            [120.64, 24.16],
            [120.66, 24.17],
            [120.68, 24.175]
          ],
          VEHICLE_ID: 1,
          BUFFER_M: 30
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ notFound: '找不到該計畫', conflict: '計畫代號已存在' })
  @Audit({ action: 'PATROL_PLAN', keys: ['ID', 'CODE', 'FREQUENCY'] })
  @RequireAction(ACTION.PROJECT.UPDATE)
  async handleUpsert(@Body() dto: UpsertPlanDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.patrolSettingService.upsert(dto, user.companyId);
  }

  /** 巡查覆蓋率 */
  @Get('patrol/coverage')
  @ApiOperation({
    summary: '巡查覆蓋率',
    description: [
      '履約檢核最常被問的數字：「這週該巡的路，有幾成真的巡到了」。',
      '',
      '把軌跡點做緩衝聯集後與計畫路線取交集，算出被覆蓋的比例 ——',
      '整段運算都在資料庫裡完成，不把幾萬個點撈回應用層。',
      '',
      '回應會直接標出未達 80% 的計畫數，那是會被扣款的部分。',
      '',
      '所需權限：`TRACK.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`COVERAGE` 為百分比' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TRACK.READ)
  async handleGetCoverage(@Query() dto: CoverageQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.patrolSettingService.getCoverage(dto, user.companyId);
  }
}
