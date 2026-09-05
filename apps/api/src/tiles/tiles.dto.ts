import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, DEGREE_DEF, NEED_REPAIR_DEF } from '@road-patrol/shared';

export class LayerQueryDto {
  @ApiPropertyOptional({ enum: CASE_STATUS_DEF.map((s) => s.value), description: '二篩狀態：0 未篩 / 1 通過 / 2 待審 / 3 刪除 / 4 誤判' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CASE_STATUS_DEF.map((s) => s.value))
  STATUS?: number;

  @ApiPropertyOptional({ enum: NEED_REPAIR_DEF.map((s) => s.value), description: '修繕狀態：-1 已完修 / 0 未判定 / 1 需修繕 / 2 已派工' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(NEED_REPAIR_DEF.map((s) => s.value))
  NEED_REPAIR?: number;

  @ApiPropertyOptional({ enum: CRACK_TYPE_DEF.map((c) => c.key), description: '破壞類型' })
  @IsOptional()
  @IsIn(CRACK_TYPE_DEF.map((c) => c.key))
  CRACK_TYPE?: string;

  @ApiPropertyOptional({ enum: DEGREE_DEF.map((d) => d.key), description: '破壞程度' })
  @IsOptional()
  @IsIn(DEGREE_DEF.map((d) => d.key))
  DEGREE?: string;

  @ApiPropertyOptional({ example: '示範市', maxLength: 10, description: '縣市' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10, description: '行政區' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;

  @ApiPropertyOptional({ example: 'DEMO01', maxLength: 10, description: '標案號' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  PRJ_ID?: string;

  @ApiPropertyOptional({ example: 'DEMO-001', maxLength: 20, description: '車牌' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  CAR?: string;

  @ApiPropertyOptional({ example: 120.55, description: '可視範圍左下經度；四個 bbox 參數要嘛全給、要嘛全不給' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  MIN_LNG?: number;

  @ApiPropertyOptional({ example: 24.11 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  MIN_LAT?: number;

  @ApiPropertyOptional({ example: 120.75 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  MAX_LNG?: number;

  @ApiPropertyOptional({ example: 24.22 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  MAX_LAT?: number;
}
