import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { GeoService } from './geo.service';

@ApiTags('Geo')
@ApiBearerAuth(API_AUTH)
@Controller()
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  /** 行政區界線 */
  @Get('geo/district-bounds')
  @ApiOperation({
    summary: '行政區界線圖層',
    description: [
      '把同一行政區的案件取凸包當作粗略界線，用於「哪一區案件最多」這種面量圖。',
      '',
      '正式系統接的是國土測繪中心的行政區圖資；那份資料有幾十 MB，',
      '放進示範專案不合理，而這個近似值足以示範界線圖層這件事。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @Header('Cache-Control', 'private, max-age=300')
  @ApiResponse({ status: 200, description: '查詢成功(GeoJSON FeatureCollection)' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetDistrictBounds(@User() user: AuthUser): Promise<HttpResult> {
    return HttpResponse.success({ data: await this.geoService.getDistrictBounds(user.companyId) });
  }

  /** 地址自動完成 */
  @Get('geo/auto-complete')
  @ApiOperation({
    summary: '地址自動完成',
    description: [
      '依關鍵字回傳既有案件的路名與地址，附帶座標與出現次數。',
      '',
      '資料來源是自己的案件而不是外部服務 —— 承辦要找的地點，',
      '多半就是出過案件的地方，命中率反而比通用地址服務高。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'KEYWORD', example: '中山' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleAutoComplete(@Query('KEYWORD') keyword: string, @User() user: AuthUser): Promise<HttpResult> {
    return HttpResponse.successOrWarn({ data: await this.geoService.autoComplete(keyword, user.companyId), warnMsg: '查無相符地點' });
  }
}
