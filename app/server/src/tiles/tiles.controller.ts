import { BadRequestException, Controller, Get, Header, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { TilesService } from './tiles.service';
import { LayerQueryDto } from './tiles.dto';

@ApiTags('Tiles')
@ApiBearerAuth('bearer')
@Controller()
export class TilesController {
  constructor(private readonly tilesService: TilesService) {}

  /** 案件向量圖磚 */
  // 地圖套件組出來的網址常帶副檔名(.mvt/.pbf)，所以 Y 允許後綴，
  // 由 handler 自己去掉 —— 直接套 ParseIntPipe 會讓標準的圖磚網址整批 400
  @Get('tiles/case/:Z/:X/:Y')
  @ApiOperation({
    summary: '案件向量圖磚(MVT)',
    description: [
      '標準的 `{z}/{x}/{y}` 向量圖磚，回傳 `application/x-protobuf`。',
      '',
      '**與 GeoJSON 端點的差別**：全市案件的 GeoJSON 是好幾 MB，而且每次平移都要重下載；',
      '圖磚只傳「這一格」，瀏覽器還會自己快取看過的格子。案件量上千時差異很明顯。',
      '',
      '圖磚由 PostGIS 直接產生(`ST_AsMVT`)，Node 端只轉手 ——',
      '在應用層裁切幾何是把資料庫最擅長的事搬到最不擅長的地方做。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '回傳向量圖磚(二進位)' })
  @ApiCommonErrors()
  @RequireAction(ACTION.CASE.READ)
  async handleGetCaseTile(
    @Param('Z', ParseIntPipe) z: number,
    @Param('X', ParseIntPipe) x: number,
    @Param('Y') yParam: string,
    @Query('STATUS') status: string | undefined,
    @User() user: AuthUser,
    @Res() res: Response
  ): Promise<void> {
    const y = Number.parseInt(yParam, 10);
    if (Number.isNaN(y)) throw new BadRequestException(`圖磚座標不是數字：${yParam}`);

    // 圖磚網址由地圖套件組出來，只會是字串；空字串代表「不篩」而不是狀態 0
    const statusValue = status === undefined || status === '' ? undefined : Number(status);
    const tile = await this.tilesService.getCaseTile(z, x, y, user.companyId, Number.isNaN(statusValue) ? undefined : statusValue);

    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // 空圖磚回 204 而不是空的 200：Leaflet/MapLibre 才知道這一格沒東西可畫
    if (!tile.length) {
      res.status(204).end();
      return;
    }

    res.send(tile);
  }

  /** 案件圖層 */
  @Get('tiles/case')
  @ApiOperation({
    summary: '案件圖層(GeoJSON)',
    description: [
      '回傳 GeoJSON FeatureCollection，由 PostGIS 直接組裝(`ST_AsGeoJSON`)，上限 20000 筆。',
      '',
      '**這支跑在獨立的 tiles 行程**：一次全市圖層是幾 MB 的 JSON，',
      '序列化時會佔住 event loop —— 混在 api 行程裡會讓登入請求跟著卡。',
      '',
      'Redis 快取 5 分鐘，瀏覽器快取 60 秒(地圖平移會連續要同一批資料)。',
      'bbox 的四個參數要嘛全給、要嘛全不給。',
      '',
      '所需權限：`CASE.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功。`message` 為 from cache 表示取自快取' })
  @ApiCommonErrors()
  // 圖層可以放在瀏覽器快取一分鐘：地圖平移時會連續要同一批資料
  @Header('Cache-Control', 'private, max-age=60')
  @RequireAction(ACTION.CASE.READ)
  async handleGetCaseLayer(@Query() dto: LayerQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    const hasBbox = [dto.MIN_LNG, dto.MIN_LAT, dto.MAX_LNG, dto.MAX_LAT].every((v) => v !== undefined);

    const { layer, cached } = await this.tilesService.getCaseLayer({
      companyId: user.companyId,
      status: dto.STATUS,
      needRepair: dto.NEED_REPAIR,
      crackType: dto.CRACK_TYPE,
      degree: dto.DEGREE,
      county: dto.COUNTY,
      district: dto.DISTRICT,
      prjId: dto.PRJ_ID,
      car: dto.CAR,
      bbox: hasBbox ? [dto.MIN_LNG!, dto.MIN_LAT!, dto.MAX_LNG!, dto.MAX_LAT!] : undefined
    });

    return HttpResponse.success({ data: layer, message: cached ? 'from cache' : 'fresh' });
  }
}
