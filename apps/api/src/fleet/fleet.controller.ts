import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { Idempotent } from '@decorators/idempotent.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { FleetService } from './fleet.service';
import { AddTrackDto, TrackQueryDto, TrackStatsQueryDto, UpsertVehicleDto, VehicleQueryDto } from './fleet.dto';

@ApiTags('Fleet')
@ApiBearerAuth(API_AUTH)
@Controller()
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  /** 車輛清單 */
  @Get('fleet/vehicle')
  @ApiOperation({
    summary: '車輛清單',
    description: [
      '回傳車輛基本資料與最後回報位置。',
      '',
      '**「在線」看的是最後回報時間而不是資料庫欄位** —— 車機是被拔電斷線的，',
      '不會有人幫它把狀態改成離線。超過 5 分鐘沒回報即視為離線。',
      '',
      '所需權限：`FLEET.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`SILENT_MIN` 是距離最後回報的分鐘數' })
  @ApiCommonErrors()
  @RequireAction(ACTION.FLEET.READ)
  async handleListVehicles(@Query() dto: VehicleQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.listVehicles(dto, user.companyId);
  }

  /** 新增或更新車輛 */
  @Post('fleet/vehicle')
  @ApiOperation({
    summary: '新增或更新車輛',
    description: ['帶 `ID` 是更新，不帶是新增。車牌在同一公司內不可重複。', '', '所需權限：`FLEET.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: UpsertVehicleDto,
    examples: {
      create: { summary: '新增巡查車', value: { PLATE_NO: 'ABC-1234', NAME: '巡查一號車', VEHICLE_TYPE: 'PATROL', DEVICE_ID: 'DEV-0001' } },
      update: { summary: '指派駕駛', value: { ID: 1, PLATE_NO: 'ABC-1234', VEHICLE_TYPE: 'PATROL', DRIVER_ID: 3 } }
    }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ notFound: '找不到該車輛', conflict: '車牌已存在' })
  @Audit({ action: 'FLEET', keys: ['ID', 'PLATE_NO', 'DRIVER_ID'] })
  @RequireAction(ACTION.FLEET.UPDATE)
  async handleUpsertVehicle(@Body() dto: UpsertVehicleDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.upsertVehicle(dto, user.companyId);
  }

  /** 車機上傳軌跡點 */
  @Post('fleet/track')
  @ApiOperation({
    summary: '上傳軌跡點',
    description: [
      '車機每數秒回報一次。這是全系統最高頻的寫入端點，因此刻意做得很薄 ——',
      '只寫一筆點並更新車輛最後位置，統計與清理都交給排程。',
      '',
      '即時位置另外寫進 Redis(TTL 2 分鐘)，看板從那裡取，不掃描軌跡表。',
      '',
      '所需權限：`TRACK.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: AddTrackDto,
    examples: {
      moving: {
        summary: '行進中',
        value: { DEVICE_ID: 'DEV-0001', LNG: 120.6478, LAT: 24.1636, RECORDED_AT: '2026-08-29T09:12:00+08:00', SPEED_KPH: 32.5, HEADING: 180, GPS_HDOP: 0.8 }
      },
      tripStart: { summary: '一趟行程的起點', value: { DEVICE_ID: 'DEV-0001', LNG: 120.64, LAT: 24.16, RECORDED_AT: '2026-08-29T08:00:00+08:00', IS_TRIP_START: true } }
    }
  })
  @ApiResponse({ status: 201, description: '已接收' })
  @ApiCommonErrors({ notFound: '找不到該車機識別碼對應的車輛' })
  @Idempotent(120)
  @RequireAction(ACTION.TRACK.CREATE)
  async handleAddTrack(@Body() dto: AddTrackDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.addTrack(dto, user.companyId);
  }

  /** 查詢軌跡 */
  @Get('fleet/track')
  @ApiOperation({
    summary: '查詢軌跡',
    description: [
      '回傳指定車輛在時間區間內的軌跡點，並附上里程、最高與平均時速。',
      '',
      '兩個限制是刻意的：`MAX_HDOP` 濾掉 GPS 飄移的點(不然畫出來像鬼畫符)，',
      '`MAX_POINTS` 做等距抽樣 —— 一天十萬點瀏覽器畫不動，而人眼在地圖上也分不出差別。',
      '抽樣用 row_number 取模而非亂數：同樣的查詢會得到同樣的結果。',
      '',
      '所需權限：`TRACK.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`SAMPLE_STEP` 為抽樣間隔，1 表示未抽樣' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TRACK.READ)
  async handleGetTrack(@Query() dto: TrackQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.getTrack(dto, user.companyId);
  }

  /** 軌跡統計 */
  @Get('fleet/track/stats')
  @ApiOperation({
    summary: '軌跡統計',
    description: ['每台車每天的巡查里程與點數，用於計費與覆蓋率檢核。', '', '所需權限：`TRACK.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.TRACK.READ)
  async handleGetTrackStats(@Query() dto: TrackStatsQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.getTrackStats(dto, user.companyId);
  }
}
