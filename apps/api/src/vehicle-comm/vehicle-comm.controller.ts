import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
import { VehicleCommService } from './vehicle-comm.service';
import { DeviceSimulatorService } from './device-simulator.service';
import { DeviceCommandDto, SimulateDeviceDto } from './vehicle-comm.dto';
import type { CommandAction } from './vehicle-comm.type';

@ApiTags('Vehicle-Comm')
@ApiBearerAuth(API_AUTH)
@Controller()
export class VehicleCommController {
  constructor(
    private readonly vehicleCommService: VehicleCommService,
    private readonly simulatorService: DeviceSimulatorService
  ) {}

  /** 車機通訊狀態 */
  @Get('fleet/comm')
  @ApiOperation({
    summary: '車機通訊狀態',
    description: [
      '目前連線中的車機：連線時間、最後回報、串流狀態、ECU 快照。',
      '',
      '狀態放在 Redis 而不是資料表 —— 連線是暫時的，而每則心跳都寫一次資料庫，',
      '十台車一天就是三萬次沒有價值的寫入。',
      '',
      '`CONTROLLABLE` 表示這台車機的連線在不在本服務實例上：',
      'socket 只存在收到它的那個行程裡，不在的話下不了指令。',
      '多實例部署要跨實例下指令的話，需要再加一層訊息匯流排 ——',
      '這裡把邊界說清楚而不是假裝它不存在。',
      '',
      '所需權限：`FLEET.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功；沒有車機連線時回 warn' })
  @ApiCommonErrors()
  @RequireAction(ACTION.FLEET.READ)
  async handleListSessions(@User() user: AuthUser): Promise<HttpResult> {
    return await this.vehicleCommService.listSessions(user.companyId);
  }

  /** 下指令 */
  @Post('fleet/comm/command')
  @ApiOperation({
    summary: '對車機下指令',
    description: [
      '送出指令並**等待車機回應(ack)**，最長 10 秒。',
      '',
      '等 ack 而不是送出就算：「開始串流」這種指令，沒有回應等於不知道成功了沒有 ——',
      '而畫面上會顯示成已開始，使用者會一直等一個永遠不會來的影像。',
      '',
      '逾時回報為 warn 而不是錯誤：指令沒送到是**業務結果**，不是系統故障。',
      '',
      '可用指令：`STREAM_START`／`STREAM_STOP` 影像串流、`ECU_QUERY` 查車輛狀態、',
      '`SNAPSHOT` 拍一張、`REBOOT` 重開機。',
      '',
      '所需權限：`FLEET.COMMAND`'
    ].join('\n')
  })
  @ApiBody({
    type: DeviceCommandDto,
    examples: {
      stream: { summary: '開始串流', value: { DEVICE_ID: 'DEV-0001', ACTION: 'STREAM_START' } },
      ecu: { summary: '查詢 ECU', value: { DEVICE_ID: 'DEV-0001', ACTION: 'ECU_QUERY' } }
    }
  })
  @ApiResponse({ status: 201, description: '指令已執行；`data.TIMED_OUT` 為 true 表示車機未在時限內回應' })
  @ApiCommonErrors({ badRequest: '車機連線不在本服務實例上', notFound: '車機未連線' })
  @Audit({ action: 'FLEET', keys: ['DEVICE_ID', 'ACTION'] })
  @RequireAction(ACTION.FLEET.COMMAND)
  async handleCommand(@Body() dto: DeviceCommandDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.vehicleCommService.sendCommand(
      user.companyId,
      dto.DEVICE_ID,
      dto.ACTION as CommandAction,
      dto.PAYLOAD
    );
  }

  /** 模擬車機 */
  @Post('fleet/comm/simulate')
  @ApiOperation({
    summary: '模擬車機連線(示範用)',
    description: [
      'Demo 沒有真的車機，但「車機通訊」這個功能沒有東西可看就等於不存在 ——',
      '一個永遠顯示「0 台連線」的看板，示範不出它解決了什麼問題。',
      '',
      '模擬器**不建立真的 WebSocket 連線**，而是直接寫入車機的狀態快取。',
      '繞過連線那一層是刻意的：要示範的是「看板上看得到車子的狀態變化」。',
      '',
      '代價是模擬出來的車機 `CONTROLLABLE` 為 false，下不了指令 ——',
      '那是誠實的，沒有連線就真的下不了指令。',
      '',
      '數值走可預期的曲線(電壓隨負載擺盪、里程單調遞增)而不是純亂數：',
      '亂數資料看起來像壞掉的感測器，示範不出「這個數字有意義」。',
      '',
      '所需權限：`FLEET.COMMAND`'
    ].join('\n')
  })
  @ApiBody({
    type: SimulateDeviceDto,
    examples: {
      basic: { summary: '模擬 60 秒', value: { DEVICE_ID: 'DEV-0001', DURATION_SEC: 60 } },
      fault: {
        summary: '模擬串流與故障碼',
        value: { DEVICE_ID: 'DEV-0002', DURATION_SEC: 120, STREAM: true, FAULT_CODE: 'P0301' }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已開始模擬' })
  @ApiCommonErrors({ notFound: '找不到該車機' })
  @Audit({ action: 'FLEET', keys: ['DEVICE_ID', 'DURATION_SEC'] })
  @RequireAction(ACTION.FLEET.COMMAND)
  async handleSimulate(@Body() dto: SimulateDeviceDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.simulatorService.start(dto, user.companyId);
  }

  @Delete('fleet/comm/simulate/:DEVICE_ID')
  @ApiOperation({
    summary: '停止模擬',
    description: ['停掉進行中的模擬並讓該車機離線。', '', '所需權限：`FLEET.COMMAND`'].join('\n')
  })
  @ApiParam({ name: 'DEVICE_ID', example: 'DEV-0001' })
  @ApiResponse({ status: 200, description: '已停止' })
  @ApiCommonErrors()
  @Audit({ action: 'FLEET', keys: [] })
  @RequireAction(ACTION.FLEET.COMMAND)
  handleStopSimulate(@Param('DEVICE_ID') deviceId: string, @User() user: AuthUser): HttpResult {
    return this.simulatorService.stop(deviceId, user.companyId);
  }
}
