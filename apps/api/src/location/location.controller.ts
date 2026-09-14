import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { LocationService } from './location.service';
import { AutoCompleteDto, ForwardGeocodeDto, ReverseGeocodeDto } from './location.dto';

/**
 * 門牌與座標的對照。
 *
 * 與 `geo` 模組的分工：`geo` 處理案件的空間查詢（附近案件、行政區界線），
 * 資料來源是案件本身；`location` 提供獨立於案件的門牌圖資，
 * 是案件地址的來源而非其衍生物。
 */
@ApiTags('Location')
@ApiBearerAuth(API_AUTH)
@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /** 座標反查地址 */
  @Post('reverse')
  @ApiOperation({
    summary: '座標反查地址',
    description: [
      '回傳搜尋半徑（150 公尺）內最近的門牌，並附上實際距離。',
      '',
      '**查無門牌時各欄位為 `null`，而不是回傳最接近的那一筆**。',
      '不設半徑上限的話，山區的一筆座標會對應到十公里外的門牌 ——',
      '而那個地址會被寫進案件、印上公文。留白比填入錯誤地址容易處理。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '查詢完成；查無門牌時各欄位為 null' })
  @ApiCommonErrors({ badRequest: '座標格式錯誤' })
  @RequireAction(ACTION.CASE.READ)
  async handleReverse(@Body() dto: ReverseGeocodeDto): Promise<HttpResult> {
    return HttpResponse.success({ data: await this.locationService.reverse(dto.LNG, dto.LAT) });
  }

  /** 地址自動完成 */
  @Get('auto-complete')
  @ApiOperation({
    summary: '地址自動完成',
    description: [
      '以路名比對，回傳去重後的路段。關鍵字少於兩個字時回傳空陣列 ——',
      '單字命中的路段太多，對輸入中的使用者沒有幫助。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleAutoComplete(@Query() dto: AutoCompleteDto): Promise<HttpResult> {
    return HttpResponse.successOrWarn({
      data: await this.locationService.autoComplete(dto.KEYWORD, dto.LIMIT),
      warnMsg: '查無相符的路段'
    });
  }

  /** 地址正查座標 */
  @Post('forward')
  @ApiOperation({
    summary: '地址正查座標',
    description: [
      '完整地址比對不到時，退回同路段的任一門牌並將 `exact` 標為 `false`。',
      '現場回報的門牌號常有誤差（99 號與 99-1 號），定位到路段已足以支援作業。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '查詢完成' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleForward(@Body() dto: ForwardGeocodeDto): Promise<HttpResult> {
    return HttpResponse.successOrWarn({
      data: await this.locationService.forward(dto.ADDRESS),
      warnMsg: '查無此地址'
    });
  }

  /** 圖資涵蓋統計 */
  @Get('coverage')
  @ApiOperation({
    summary: '門牌圖資涵蓋統計',
    description: ['門牌筆數、已載入的網格數與涵蓋的行政區數；維運用來確認圖資範圍。', '', '所需權限：`CASE.READ`'].join(
      '\n'
    )
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleCoverage(): Promise<HttpResult> {
    return HttpResponse.success({ data: await this.locationService.coverage() });
  }
}
