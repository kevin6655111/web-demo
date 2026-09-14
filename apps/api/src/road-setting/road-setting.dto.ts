import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import { JURISDICTION } from './entities/road-line.entity';
import { ROAD_BLOCK_STATUS, ROAD_BLOCK_TYPE } from './entities/road-block.entity';
import { ToArray, ToNumberArray } from '@/case-patrol/case-patrol.dto';

/** 圖台的空間條件；線段、區塊、巡查點三種查詢共用 */
class GeoScopeDto {
  @ApiPropertyOptional({ example: '示範市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', isArray: true, description: '行政區，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  DISTRICT?: string[];

  @ApiPropertyOptional({ example: '中山路', maxLength: 100, description: '路名，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;

  @ApiPropertyOptional({
    example: [120.6, 24.14, 120.7, 24.19],
    isArray: true,
    description: '視野範圍 [minLng, minLat, maxLng, maxLat]；只回傳框內的圖徵'
  })
  @IsOptional()
  @ToNumberArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsNumber({}, { each: true })
  BBOX?: number[];
}

// ─── 道路線段 ────────────────────────────────────────────────────

export class RoadLineQueryDto extends GeoScopeDto {
  @ApiPropertyOptional({ enum: JURISDICTION, isArray: true, description: '管轄單位，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(JURISDICTION as unknown as string[], { each: true })
  JURISDICTION?: string[];

  @ApiPropertyOptional({ example: true, description: '只看納入巡查的' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  IS_ACTIVE?: boolean;

  @ApiPropertyOptional({ example: true, description: '只看還沒命名的線段（圖資常有一堆無名線）' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  UNNAMED_ONLY?: boolean;
}

/** 批次啟用/停用：圖台上框選一片線段之後一次送 */
export class BatchActiveDto {
  @ApiProperty({ example: [1, 2, 3], type: [Number] })
  @ToNumberArray()
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiProperty({ example: false, description: 'true 納入巡查、false 排除' })
  @IsBoolean()
  IS_ACTIVE!: boolean;

  @ApiPropertyOptional({ example: '施工中，本季不巡', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

/** 批次設定管轄單位 */
export class BatchJurisdictionDto {
  @ApiProperty({ example: [1, 2], type: [Number] })
  @ToNumberArray()
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiProperty({ enum: JURISDICTION, example: 'TOWNSHIP' })
  @IsIn(JURISDICTION as unknown as string[])
  JURISDICTION!: string;
}

/** 命名：一次改一條，因為名字本來就是一條一條看著地圖打的 */
export class RenameRoadLineDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ example: '文心路四段', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  DISPLAY_NAME!: string;
}

// ─── 道路區塊 ────────────────────────────────────────────────────

export class RoadBlockQueryDto extends GeoScopeDto {
  @ApiPropertyOptional({ enum: ROAD_BLOCK_TYPE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(ROAD_BLOCK_TYPE as unknown as string[], { each: true })
  BLOCK_TYPE?: string[];

  @ApiPropertyOptional({ enum: ROAD_BLOCK_STATUS, isArray: true, description: '0 未設定 / 1 納入 / 2 不納入 / 3 施工中' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(ROAD_BLOCK_STATUS, { each: true })
  STATUS?: number[];
}

export class BatchBlockUpdateDto {
  @ApiProperty({ example: [1, 2], type: [Number] })
  @ToNumberArray()
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiPropertyOptional({ enum: ROAD_BLOCK_STATUS, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(ROAD_BLOCK_STATUS)
  STATUS?: number;

  @ApiPropertyOptional({ enum: ROAD_BLOCK_TYPE, example: 'LANE' })
  @IsOptional()
  @IsIn(ROAD_BLOCK_TYPE as unknown as string[])
  BLOCK_TYPE?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  LANE_COUNT?: number;

  @ApiPropertyOptional({ example: '路口十字範圍', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

// ─── 巡查點 ──────────────────────────────────────────────────────

export class PatrolPointQueryDto extends GeoScopeDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  IS_ACTIVE?: boolean;
}

export class UpsertPatrolPointDto {
  @ApiPropertyOptional({ example: 3, description: '有帶就是更新' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 'PT-001', maxLength: 40 })
  @IsString()
  @Length(1, 40)
  CODE!: string;

  @ApiProperty({ example: '中山路／文心路口', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  NAME!: string;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiPropertyOptional({ example: '示範市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;

  @ApiPropertyOptional({ example: '中山路一段', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;

  @ApiPropertyOptional({ example: 30, default: 30, description: '判定半徑(m)：軌跡點落在範圍內就算巡到' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(500)
  RADIUS_M?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  IS_ACTIVE?: boolean;

  @ApiPropertyOptional({ example: '業主指定每週巡查', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

// ─── 覆蓋率 ──────────────────────────────────────────────────────

export class PointCoverageQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  DATE_START!: string;

  @ApiProperty({ example: '2026-09-14' })
  @IsDateString()
  DATE_END!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;
}

/** 手繪路線：在圖台上畫一條線問「這條路線上有哪些巡查點與案件」 */
export class DrawRouteDto {
  @ApiProperty({
    example: [
      [120.64, 24.16],
      [120.66, 24.17]
    ],
    description: '路線座標序列 [[lng, lat], …]，至少兩點'
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  ROUTE!: [number, number][];

  @ApiPropertyOptional({ example: 50, default: 50, description: '緩衝距離(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(500)
  BUFFER_M?: number;
}
