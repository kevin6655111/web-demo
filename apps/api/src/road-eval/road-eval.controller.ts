import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { RoadEvalService } from './road-eval.service';
import { SegmentEvalDto, SegmentQueryDto, UpdateSegmentDto } from './road-eval.dto';

@ApiTags('Road-Eval')
@ApiBearerAuth(API_AUTH)
@Controller()
export class RoadEvalController {
  constructor(private readonly roadEvalService: RoadEvalService) {}

  /** 路段清單 */
  @Get('roadeval/segment')
  @ApiOperation({
    summary: '路段清單',
    description: [
      '依 PCI 由低到高排序 —— 最該修的排最前面。',
      '',
      '案件是「點」、路段是「線」，決策的單位是路段：',
      '不會為了一個坑洞刨鋪整條路，但一條路上密集出現坑洞就該整段處理。',
      '',
      '所需權限：`ROAD_EVAL.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_EVAL.READ)
  async handleList(@Query() dto: SegmentQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadEvalService.list(dto, user.companyId);
  }

  /** 路段圖層 */
  @Get('roadeval/layer')
  @ApiOperation({
    summary: '路段圖層(GeoJSON LineString)',
    description: [
      '給地圖依養護等級著色用。這是道路評估唯一真正有用的呈現方式 ——',
      '表格看不出「壞的路連成一片」，地圖一眼就看得到。',
      '',
      '所需權限：`ROAD_EVAL.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_EVAL.READ)
  async handleGetLayer(@Query() dto: SegmentQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadEvalService.getLayer(dto, user.companyId);
  }

  /** 等級分布 */
  @Get('roadeval/summary')
  @ApiOperation({
    summary: '養護等級分布',
    description: ['各等級的路段數、里程與平均 PCI，以及「需維修比例」。', '', '所需權限：`ROAD_EVAL.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_EVAL.READ)
  async handleGetSummary(@User() user: AuthUser): Promise<HttpResult> {
    return await this.roadEvalService.getSummary(user.companyId);
  }

  /** 人工調整 */
  @Put('roadeval/segment')
  @ApiOperation({
    summary: '調整路段評分',
    description: [
      '人工修正 PCI 或 IRI。',
      '',
      '**養護等級不接受直接指定** —— 它一律由 PCI 推導，',
      '否則兩個欄位會互相矛盾，而報表不知道該信哪一個。',
      '',
      '所需權限：`ROAD_EVAL.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpdateSegmentDto,
    examples: {
      manual: { summary: '檢測後修正 PCI', value: { ID: 5, PCI: 72.5, IRI: 3.2, REMARK: '116 年度已完成刨鋪' } }
    }
  })
  @ApiResponse({ status: 200, description: '已更新，回傳重新推導出的養護等級' })
  @ApiCommonErrors({ notFound: '找不到該路段' })
  @Audit({ action: 'ROAD_EVAL', keys: ['ID', 'PCI'] })
  @RequireAction(ACTION.ROAD_EVAL.UPDATE)
  async handleUpdate(@Body() dto: UpdateSegmentDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadEvalService.update(dto, user.companyId);
  }

  /** 依案件密度重算 */
  @Post('roadeval/evaluate')
  @ApiOperation({
    summary: '依案件密度重算評分',
    description: [
      '掃描近 180 天、距離路段 30 公尺內的案件，換算成 PCI 扣分。',
      '',
      '算法刻意簡單且可解釋：每公里案件數 × 6 分、破壞面積 × 4 分，下限 5 分。',
      '正式系統會接鋪面檢測車的資料，但那只是換掉分數來源 ——',
      '「路段有分數、分數決定等級」的結構不變。',
      '',
      '此端點也由 `roadEvalStat` 排程每日自動呼叫。',
      '',
      '所需權限：`ROAD_EVAL.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: SegmentEvalDto,
    examples: {
      all: { summary: '全部路段', value: {} },
      byProject: { summary: '只算某標案', value: { PROJECT_ID: 1 } }
    }
  })
  @ApiResponse({ status: 201, description: '評估完成，回傳更新筆數' })
  @ApiCommonErrors()
  @Audit({ action: 'ROAD_EVAL', keys: ['PROJECT_ID'] })
  @RequireAction(ACTION.ROAD_EVAL.UPDATE)
  async handleEvaluate(@Body() dto: SegmentEvalDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadEvalService.evaluate(dto, user.companyId);
  }
}
