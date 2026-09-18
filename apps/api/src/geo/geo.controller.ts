import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/api-docs/swagger.helper';
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
    return HttpResponse.successOrWarn({
      data: await this.geoService.autoComplete(keyword, user.companyId),
      warnMsg: '查無相符地點'
    });
  }
  /** 行政區界線圖層 */
  @Get('geo/region')
  @ApiOperation({
    summary: '行政區界線圖層',
    description: [
      '三層界線：`COUNTY` 縣市、`DISTRICT` 鄉鎮市區、`VILLAGE` 村里。',
      '',
      '**里這一層是關鍵**：派工是按里分派的（「這個里歸第一班」），',
      '報表上業主要的也是里別統計。只到區的話，一個區有三十個里，',
      '「這件在哪裡」還是答不出來。',
      '',
      '回傳 GeoJSON `FeatureCollection`。查 `VILLAGE` 時建議帶 `DISTRICT` 收斂範圍。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'LEVEL', enum: ['COUNTY', 'DISTRICT', 'VILLAGE'], required: false, example: 'DISTRICT' })
  @ApiQuery({ name: 'COUNTY', required: false, example: '示範市' })
  @ApiQuery({ name: 'DISTRICT', required: false, example: '西屯區' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetRegions(
    @Query('LEVEL') level = 'DISTRICT',
    @Query('COUNTY') county?: string,
    @Query('DISTRICT') district?: string
  ): Promise<HttpResult> {
    const data = await this.geoService.getRegionLayer(level as never, { county, district });
    return HttpResponse.successOrWarn({ data, isEmpty: (v) => !v?.features?.length, warnMsg: '沒有這個層級的界線圖資' });
  }

  /** 座標落在哪一個行政區 */
  @Get('geo/locate')
  @ApiOperation({
    summary: '座標所在的行政區',
    description: [
      '由小到大回傳（里 → 區 → 縣市）：呼叫端要的通常是最細的那一層，',
      '但界線資料不見得完整到里，所以要能退到區。',
      '',
      '用 `ST_Contains` 而不是最近距離：行政區是面，「在不在裡面」有明確答案，',
      '而「最近的那一個」在邊界附近會給出錯的結果。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'LNG', example: 120.6478 })
  @ApiQuery({ name: 'LAT', example: 24.1636 })
  @ApiResponse({ status: 200, description: '查詢成功；不在任何界線內時三個欄位皆為 null' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleLocate(@Query('LNG') lng: string, @Query('LAT') lat: string): Promise<HttpResult> {
    const result = await this.geoService.whichRegion(Number(lng), Number(lat));

    return HttpResponse.successOrWarn({
      data: { COUNTY: result.county, DISTRICT: result.district, VILLAGE: result.village },
      isEmpty: (v) => !v?.COUNTY,
      warnMsg: '這個座標不在任何已知的行政區界線內'
    });
  }

  /** 道路量測資料 */
  @Get('geo/road-meas')
  @ApiOperation({
    summary: '道路量測資料',
    description: [
      '計價的分母：契約寫「每平方公尺多少錢」，而面積 = 長度 × 寬度。',
      '',
      '面積由後端算好回傳 —— 每個呼叫端各乘一次的話，四捨五入的時機會不一樣，',
      '而請款金額對不起來是很難查的那種問題。',
      '',
      '與道路線段（`/road-setting/line`）分開：量測值一年更新一次，圖形隨時可能變動。',
      '',
      '所需權限：`ROAD_EVAL.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'COUNTY', required: false, example: '示範市' })
  @ApiQuery({ name: 'DISTRICT', required: false, example: '西屯區' })
  @ApiQuery({ name: 'KEYWORD', required: false, example: '中山', description: '路名或編號，模糊比對' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ROAD_EVAL.READ)
  async handleRoadMeas(
    @Query('COUNTY') county?: string,
    @Query('DISTRICT') district?: string,
    @Query('KEYWORD') keyword?: string
  ): Promise<HttpResult> {
    const rows = await this.geoService.listRoadMeas({ county, district, keyword });
    return HttpResponse.successOrWarn({ data: rows, warnMsg: '查無道路量測資料' });
  }


  /** 建物圖層 */
  @Get('geo/building')
  @ApiOperation({
    summary: '建物圖層',
    description: [
      '判斷施工影響範圍用的底圖。一個要封街刨鋪的路段，旁邊是住宅還是廠區，',
      '決定施工時段與交維方式 —— 那個判斷在只有道路的地圖上做不出來。',
      '',
      '**沒有做真正的 3D 拉伸**：那需要 deck.gl 這類 WebGL 繪圖層，',
      '為了一個判讀用的輔助圖層多背幾百 KB 的前端依賴並不划算。',
      '樓高以顏色深淺表達，點開看得到實際樓層數。這是取捨，不是做不到。',
      '',
      '只回傳輪廓、用途與樓高，不含任何室內或住戶資訊。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'DISTRICT', required: false, example: '西屯區' })
  @ApiQuery({ name: 'USAGE', required: false, example: 'SCHOOL', description: '用途；決定施工時段限制' })
  @ApiQuery({ name: 'MIN_LEVELS', required: false, example: 5, description: '只看幾層以上' })
  @ApiQuery({ name: 'BBOX', required: false, example: '120.60,24.12,120.70,24.20', description: '可視範圍，逗號分隔' })
  @ApiResponse({ status: 200, description: '查詢成功，GeoJSON FeatureCollection' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleBuildingLayer(
    @Query('DISTRICT') district?: string,
    @Query('USAGE') usage?: string,
    @Query('MIN_LEVELS') minLevels?: string,
    @Query('BBOX') bbox?: string
  ): Promise<HttpResult> {
    const data = await this.geoService.getBuildingLayer({
      district,
      usage,
      minLevels: minLevels ? Number(minLevels) : undefined,
      bbox: bbox ? bbox.split(',').map(Number) : undefined
    });

    return HttpResponse.success({ data });
  }

  /** 周邊建物影響 */
  @Get('geo/building-impact')
  @ApiOperation({
    summary: '周邊建物影響評估',
    description: [
      '派工前要回答的是「這裡施工會影響誰」：周邊有幾戶住宅、有沒有學校或醫院。',
      '這個數字決定交維計畫要不要另外送審。',
      '',
      '學校與醫院單獨列出 —— 前者要避開上下學時段，後者不能封死出入口，',
      '兩者都不是「多一點住戶」那種等級的差別。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiQuery({ name: 'LNG', example: 120.6478 })
  @ApiQuery({ name: 'LAT', example: 24.1636 })
  @ApiQuery({ name: 'RADIUS', required: false, example: 100, description: '半徑(公尺)，預設 100' })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleBuildingImpact(
    @Query('LNG') lng: string,
    @Query('LAT') lat: string,
    @Query('RADIUS') radius?: string
  ): Promise<HttpResult> {
    const data = await this.geoService.buildingImpact(Number(lng), Number(lat), radius ? Number(radius) : 100);
    return HttpResponse.success({ data });
  }

}
