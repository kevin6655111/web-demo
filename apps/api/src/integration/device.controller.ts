import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { Idempotent } from '@decorators/idempotent.decorator';
import { AllowApiKey } from '@decorators/api-key.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_KEY_AUTH } from '@/api-docs/swagger.helper';
import { CasePatrolService } from '@/case-patrol/case-patrol.service';
import { AddCaseDto } from '@/case-patrol/case-patrol.dto';
import { FleetService } from '@/fleet/fleet.service';
import { AddTrackDto } from '@/fleet/fleet.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description: '去重鍵，建議直接用案件外部編號。同一把 key 重送會回放第一次的結果，不會重複建立資料',
  schema: { type: 'string', example: 'TXG-20260829-000123' }
} as const;

/**
 * 車機的上傳介面。
 *
 * 這兩支端點與內部介面**放在不同的 controller**，理由不是排版：
 *
 * `@ApiTags` 在 class 層與 method 層是疊加而非覆蓋 —— 留在原本的 controller 裡
 * 就會同時屬於「Case-Patrol」與「Device」兩個章節，而對外文件是依 tag 過濾的，
 * 一支端點掛兩個 tag 會讓過濾的結果無法預期。
 *
 * 集中起來還有一個好處：「我們對外開了什麼」看一個目錄就回答得了。
 */
@ApiTags('Device')
@ApiSecurity(API_KEY_AUTH)
@Controller()
export class DeviceController {
  constructor(
    private readonly casePatrolService: CasePatrolService,
    private readonly fleetService: FleetService
  ) {}

  /** 新增巡查案件(車機上傳) */
  @Post('patrol/case')
  @ApiOperation({
    summary: '上傳路面破壞案件',
    description: [
      '車機偵測到路面破壞後上傳。',
      '',
      '**重送安全**：上游常在收不到回應時自動重送，本端點有三層去重 ——',
      '`Idempotency-Key` 表頭、佇列的工作編號、以及 `EXTERNAL_ID` 的資料庫唯一鍵。',
      '重複遞送會回傳既有案件的 `ID` 並帶 `DUPLICATED: true`，HTTP 狀態仍是成功。',
      '',
      '**座標校正**：有帶 `HEADING`(方位角)時，系統會把座標往行進方向推約 5 公尺 ——',
      '天線在車頂而破壞在鏡頭正前方，不校正的話地圖上的點會系統性地偏在道路後方。',
      '沒帶方位角就不校正：猜方向比不校正更糟。原始座標會另存一份。',
      '',
      '**破壞類型**：認得常見的別名(`pothole`、`Manhole`、中文)並轉成系統代碼；',
      '認不得的值會被驗證擋下而不是猜。',
      '',
      '**非同步後續**：路名由 worker 稍後補上，因此剛建立的案件地址欄位會是 null。'
    ].join('\n')
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiBody({
    type: AddCaseDto,
    examples: {
      pothole: {
        summary: '坑洞',
        value: {
          EXTERNAL_ID: 'TXG-20260829-000123',
          DT_RECORD: '2026-08-29T09:12:00.123+08:00',
          PRJ_ID: 'DEMO01',
          CAR: 'DEMO-001',
          CRACK_TYPE: 'Potholes',
          DEGREE: 'A',
          LNG: 120.6478,
          LAT: 24.1636,
          HEADING: 135,
          LENGTH: 0.7,
          WIDTH: 0.5,
          AREA: 0.35,
          DEPTH: 8,
          IMG: 'cases/TXG-20260829-000123.jpg',
          IMG_DETECT: 'cases/TXG-20260829-000123_detect.jpg',
          SERIAL_NO: 128
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '建立成功。`data.DUPLICATED` 為 true 表示這是重複遞送，未新增資料' })
  @ApiCommonErrors({ conflict: '相同 Idempotency-Key 用於不同內容，或前一筆相同請求仍在處理中' })
  @AllowApiKey()
  @Idempotent(600)
  @Audit({ action: 'CASE', keys: ['EXTERNAL_ID', 'CRACK_TYPE', 'DT_RECORD'] })
  @RequireAction(ACTION.CASE.CREATE)
  async handleAddCase(@Body() dto: AddCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.casePatrolService.addCase(dto, user);
  }

  /** 上傳軌跡點 */
  @Post('fleet/track')
  @ApiOperation({
    summary: '上傳巡查軌跡點',
    description: [
      '車機每 5 秒上傳一筆。這是全系統最高頻的寫入，所以刻意做得很薄：',
      '不查關聯、不算距離、不推播 —— 只寫一筆點並更新車輛的最後位置。',
      '',
      '`DEVICE_ID` 是車機識別碼而不是車牌：換車牌時這個值不變。',
      '',
      '`GPS_HDOP` 請照實填：大於 5 的點在查詢時會被濾掉，',
      '因為那些點畫出來像鬼畫符，而里程會被原地跳動灌水。',
      '',
      '`IS_TRIP_START` 標記一趟行程的起點，里程計算靠它切段 ——',
      '沒有它的話，回廠的那段路會被算進巡查里程。'
    ].join('\n')
  })
  @ApiBody({
    type: AddTrackDto,
    examples: {
      point: {
        summary: '行駛中',
        value: {
          DEVICE_ID: 'DEV-0001',
          LNG: 120.6478,
          LAT: 24.1636,
          RECORDED_AT: '2026-08-29T09:12:00+08:00',
          SPEED_KPH: 32.5,
          HEADING: 180,
          GPS_HDOP: 0.8,
          IS_TRIP_START: false
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已接收' })
  @ApiCommonErrors({ notFound: '找不到該車機識別碼' })
  @AllowApiKey()
  @RequireAction(ACTION.TRACK.CREATE)
  async handleAddTrack(@Body() dto: AddTrackDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.fleetService.addTrack(dto, user.companyId);
  }
}
