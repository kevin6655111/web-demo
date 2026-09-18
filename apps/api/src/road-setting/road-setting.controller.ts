import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { RoadSettingService } from './road-setting.service';
import {
  BatchActiveDto,
  BatchBlockUpdateDto,
  BatchJurisdictionDto,
  DrawRouteDto,
  PatrolPointQueryDto,
  PointCoverageQueryDto,
  RenameRoadLineDto,
  RoadBlockQueryDto,
  RoadLineQueryDto,
  UpsertPatrolPointDto
} from './road-setting.dto';

@ApiTags('Road-Setting')
@ApiBearerAuth(API_AUTH)
@Controller()
export class RoadSettingController {
  constructor(private readonly roadSettingService: RoadSettingService) {}

  // ═══ 道路線段 ═══════════════════════════════════════════════════

  @Get('road-setting/line')
  @ApiOperation({
    summary: '道路線段圖層',
    description: [
      '回傳 GeoJSON `FeatureCollection`。圖資來自政府開放資料，有兩個特性讓它不能直接用：',
      '',
      '- **名稱不完整**：相當比例的線段沒有路名。`label` 會依序取人工命名 → 原始名稱 → 「(無名路段)」，',
      '  用 `UNNAMED_ONLY=true` 可以只撈出還沒命名的那些。',
      '- **管轄單位混在一起**：市府、公所、公路單位的路在同一份圖資裡，用 `JURISDICTION` 篩。',
      '',
      '`BBOX` 是視野範圍 `[minLng, minLat, maxLng, maxLat]` —— 圖台縮到某一區時',
      '沒必要把整個城市的線段送過去。單次上限 5000 條。',
      '',
      '所需權限：`ROAD_SETTING.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_SETTING.READ)
  async handleListLines(@Query() dto: RoadLineQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.listLines(dto, user.companyId);
  }

  @Put('road-setting/line/active')
  @ApiOperation({
    summary: '批次納入或排除巡查範圍',
    description: [
      '圖台上框選一片線段之後一次送。一條一條點的話，「把這個里的巷弄全部排除」要按上百次。',
      '',
      '「納不納入巡查」與「歸誰管」是兩件事：歸市府管但正在施工的路段，',
      '管轄仍是市府，但這個月不巡。',
      '',
      '所需權限：`ROAD_SETTING.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: BatchActiveDto,
    examples: { exclude: { summary: '排除施工路段', value: { IDS: [12, 13], IS_ACTIVE: false, REMARK: '施工中' } } }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '未指定線段' })
  @Audit({ action: 'ROAD_SETTING', keys: ['IDS', 'IS_ACTIVE'] })
  @RequireAction(ACTION.ROAD_SETTING.UPDATE)
  async handleSetLinesActive(@Body() dto: BatchActiveDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.setLinesActive(dto, user.companyId);
  }

  @Put('road-setting/line/jurisdiction')
  @ApiOperation({
    summary: '批次設定管轄單位',
    description: [
      '不標管轄的話，覆蓋率的分母永遠是錯的 —— 巡查標案只負責其中一部分的路。',
      '',
      '所需權限：`ROAD_SETTING.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: BatchJurisdictionDto,
    examples: { township: { summary: '改為公所管轄', value: { IDS: [20, 21], JURISDICTION: 'TOWNSHIP' } } }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '未指定線段' })
  @Audit({ action: 'ROAD_SETTING', keys: ['IDS', 'JURISDICTION'] })
  @RequireAction(ACTION.ROAD_SETTING.UPDATE)
  async handleSetJurisdiction(@Body() dto: BatchJurisdictionDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.setLinesJurisdiction(dto, user.companyId);
  }

  @Put('road-setting/line/name')
  @ApiOperation({
    summary: '命名道路線段',
    description: [
      '人工命名會蓋掉圖資的原始名稱，但原始名稱留著以便對照下一版圖資。',
      '',
      '**一次一條而不是批次**：名字是看著地圖一條一條打的，批次命名只會讓十條路叫同一個名字。',
      '',
      '所需權限：`ROAD_SETTING.UPDATE`'
    ].join('\n')
  })
  @ApiBody({ type: RenameRoadLineDto, examples: { rename: { summary: '命名', value: { ID: 5, DISPLAY_NAME: '文心路四段' } } } })
  @ApiResponse({ status: 200, description: '已命名' })
  @ApiCommonErrors({ notFound: '找不到線段' })
  @Audit({ action: 'ROAD_SETTING', keys: ['ID', 'DISPLAY_NAME'] })
  @RequireAction(ACTION.ROAD_SETTING.UPDATE)
  async handleRenameLine(@Body() dto: RenameRoadLineDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.renameLine(dto, user.companyId);
  }

  // ═══ 道路區塊 ═══════════════════════════════════════════════════

  @Get('road-setting/block')
  @ApiOperation({
    summary: '道路區塊圖層',
    description: [
      '線段回答「這條路在哪裡」，區塊回答「這一段路有多大」——',
      '計價、鋪面面積、養護預算都以面積為單位，而線段只有長度。',
      '',
      '`status`：0 未設定 / 1 納入巡查 / 2 不納入 / 3 施工中。',
      '',
      '所需權限：`ROAD_SETTING.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_SETTING.READ)
  async handleListBlocks(@Query() dto: RoadBlockQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.listBlocks(dto, user.companyId);
  }

  @Put('road-setting/block')
  @ApiOperation({
    summary: '批次更新道路區塊',
    description: ['狀態、類型、車道數與備註，只送要改的欄位。', '', '所需權限：`ROAD_SETTING.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: BatchBlockUpdateDto,
    examples: { include: { summary: '納入巡查', value: { IDS: [3, 4], STATUS: 1 } } }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '未指定區塊或沒有要更新的欄位' })
  @Audit({ action: 'ROAD_SETTING', keys: ['IDS', 'STATUS'] })
  @RequireAction(ACTION.ROAD_SETTING.UPDATE)
  async handleUpdateBlocks(@Body() dto: BatchBlockUpdateDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.updateBlocks(dto, user.companyId);
  }

  // ═══ 巡查點 ═════════════════════════════════════════════════════

  @Get('road-setting/point')
  @ApiOperation({
    summary: '巡查點圖層',
    description: [
      '契約常寫「這些路口每週至少要看一次」—— 那是點而不是線，用路線覆蓋率算不出來：',
      '一條路線的 90% 覆蓋率，可能正好漏掉了業主最在意的那個路口。',
      '',
      '`radiusM` 是判定半徑，每個點各自設定 —— 大路口與小巷口的合理範圍不同。',
      '',
      '所需權限：`ROAD_SETTING.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_SETTING.READ)
  async handleListPoints(@Query() dto: PatrolPointQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.listPoints(dto, user.companyId);
  }

  @Post('road-setting/point')
  @ApiOperation({
    summary: '新增或更新巡查點',
    description: ['有帶 `ID` 就是更新。代號在公司內唯一。', '', '所需權限：`ROAD_SETTING.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: UpsertPatrolPointDto,
    examples: {
      create: {
        summary: '新增路口巡查點',
        value: { CODE: 'PT-001', NAME: '中山路／文心路口', LNG: 120.6478, LAT: 24.1636, DISTRICT: '西屯區', RADIUS_M: 40 }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ conflict: '巡查點代號已存在', notFound: '找不到巡查點' })
  @Audit({ action: 'ROAD_SETTING', keys: ['CODE', 'NAME'] })
  @RequireAction(ACTION.ROAD_SETTING.UPDATE)
  async handleUpsertPoint(@Body() dto: UpsertPatrolPointDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.upsertPoint(dto, user.companyId);
  }

  // ═══ 覆蓋率與手繪 ═══════════════════════════════════════════════

  @Get('road-setting/point-coverage')
  @ApiOperation({
    summary: '巡查點覆蓋率',
    description: [
      '讀每日統計表，不即時算 —— 覆蓋率要掃整天的軌跡點與所有巡查點做空間比對，',
      '一次幾秒鐘，而它是報表與看板每次開啟都要的數字。統計由 `patrolPointCov` 排程產生。',
      '',
      '**判定方式是相鄰軌跡點連成線段再比對距離**，不是逐點比對：',
      '車機每 5 秒一筆，時速 50 公里時兩點之間有 70 公尺 —— 逐點比對會讓車子',
      '「跳過」半徑 30 公尺的巡查點，明明開過去了卻沒算到。',
      '',
      '`NO_TRACK_DAYS` 是「當天完全沒有軌跡」的筆數：覆蓋率 0 時要分得出',
      '「沒出車」(調度問題)與「出車但沒到點」(路線規劃問題)。',
      '',
      '所需權限：`TRACK.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TRACK.READ)
  async handlePointCoverage(@Query() dto: PointCoverageQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.pointCoverage(dto, user.companyId);
  }

  @Post('road-setting/draw')
  @ApiOperation({
    summary: '手繪路線查詢',
    description: [
      '在圖台上畫一條線，回傳這條路線緩衝範圍內的巡查點、道路線段與案件。',
      '',
      '規劃新巡查路線時要先知道它會經過什麼 —— 畫完才發現漏掉三個指定巡查點，',
      '就要整條重畫。',
      '',
      '所需權限：`ROAD_SETTING.READ`'
    ].join('\n')
  })
  @ApiBody({
    type: DrawRouteDto,
    examples: {
      draw: {
        summary: '畫一段路線',
        value: {
          ROUTE: [
            [120.64, 24.16],
            [120.66, 24.17],
            [120.68, 24.175]
          ],
          BUFFER_M: 50
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_SETTING.READ)
  async handleDrawRoute(@Body() dto: DrawRouteDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.roadSettingService.drawRoute(dto, user.companyId);
  }
}
