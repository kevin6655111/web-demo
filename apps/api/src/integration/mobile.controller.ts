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
import { SurveyService } from '@/survey/survey.service';
import { AppSurveyCaseDto } from '@/survey/survey.dto';

/**
 * 行動應用的現場收案介面。
 *
 * 與車機介面分開成兩個 controller，因為它們是**兩個不同的對接單位**：
 * 對外文件依 tag 過濾，兩者混在一起的話，車機廠商會看到鋪面調查的介面。
 */
@ApiTags('Mobile')
@ApiSecurity(API_KEY_AUTH)
@Controller()
export class MobileController {
  constructor(private readonly surveyService: SurveyService) {}

  /** App 現場收案 */
  @Post('survey/app/case')
  @ApiOperation({
    summary: '上傳鋪面調查點',
    description: [
      '現場人員在 App 上填的調查點：位置、車道、樁號、天氣、破壞類型與尺寸。',
      '',
      '**明細是選填的** —— 現場人員不一定知道這個點屬於委託單的第幾項。',
      '沒帶 `DETAIL_ID` 就由系統依 `ROAD_NAME` 比對，比不到就當成臨時加測。',
      '',
      '**重送安全**：`EXTERNAL_ID` 有唯一索引，現場網路不穩時 App 會重送。',
      '重複遞送回傳既有案件並帶 `DUPLICATED: true`。',
      '',
      '**破壞面積不需要傳**：由 `DTYPE_LENGTH` × `DTYPE_WIDTH` 算出來 ——',
      '兩邊各算一次一定會有對不上的資料，而報表是要交給業主的那一份。'
    ].join('\n')
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '去重鍵，建議用 `EXTERNAL_ID`',
    schema: { type: 'string', example: 'SV-APP-20260901-0001' }
  })
  @ApiBody({
    type: AppSurveyCaseDto,
    examples: {
      field: {
        summary: '現場目視調查',
        value: {
          EXTERNAL_ID: 'SV-APP-20260901-0001',
          ORDER_ID: 1,
          LNG: 120.6478,
          LAT: 24.1636,
          METHOD: 'VISUAL',
          ROAD_NAME: '中山路一段',
          COUNTY: '示範市',
          DISTRICT: '西屯區',
          LANE: 2,
          STATION_K: 3,
          STATION_M: 250,
          WEATHER: '晴',
          DTYPE: 'Alligator_Cracking',
          DEGREE: 'B',
          DTYPE_LENGTH: 2.5,
          DTYPE_WIDTH: 1.2,
          PCI: 62.5,
          FINDING: '龜裂範圍擴大，建議納入刨鋪'
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '已建立；`data.DUPLICATED` 為 true 表示重複遞送' })
  @ApiCommonErrors({ notFound: '找不到委託單或明細' })
  @AllowApiKey()
  @Idempotent(600)
  @Audit({ action: 'SURVEY', keys: ['EXTERNAL_ID', 'ORDER_ID', 'METHOD'] })
  @RequireAction(ACTION.SURVEY.CREATE)
  async handleAppIntake(@Body() dto: AppSurveyCaseDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.surveyService.appIntake(dto, user);
  }
}
