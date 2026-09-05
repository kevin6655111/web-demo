import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { SURVEY_ORDER_STATE } from './entities/survey-order.entity';
import { SURVEY_CASE_STATE, SURVEY_METHOD } from './entities/survey-case.entity';
import { ToArray } from '@/fleet/fleet.dto';

export class SurveyOrderQueryDto {
  @ApiPropertyOptional({ example: 'SV-2026', description: '委託單號，部分比對' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ORDER_NO?: string;

  @ApiPropertyOptional({ enum: SURVEY_ORDER_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_ORDER_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;
}

export class UpsertSurveyOrderDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: '臺灣大道路面爭議調查' })
  @IsString()
  @MaxLength(100)
  TITLE!: string;

  @ApiPropertyOptional({ example: '示範市政府建設局', description: '委託單位' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  REQUESTER?: string;

  @ApiPropertyOptional({ example: 3, description: '指派的調查人員' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SURVEYOR_ID?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '2026-09-15' })
  @IsOptional()
  @IsDateString()
  DUE_DATE?: string;

  @ApiPropertyOptional({ enum: SURVEY_ORDER_STATE, example: 'ISSUED' })
  @IsOptional()
  @IsIn(SURVEY_ORDER_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: '含三處鑽心取樣' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  REMARK?: string;
}

export class SurveyCaseQueryDto {
  @ApiPropertyOptional({ example: 1, description: '所屬委託單' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ORDER_ID?: number;

  @ApiPropertyOptional({ enum: SURVEY_CASE_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_CASE_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ enum: SURVEY_METHOD, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_METHOD as unknown as string[], { each: true })
  METHOD?: string[];

  @ApiPropertyOptional({ example: '中山路' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;
}

export class UpsertSurveyCaseDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ORDER_ID!: number;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiProperty({ enum: SURVEY_METHOD, example: 'CORE_DRILL', description: '不同方法可信度不同，報告會標出來' })
  @IsIn(SURVEY_METHOD as unknown as string[])
  METHOD!: string;

  @ApiPropertyOptional({ example: '中山路一段' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;

  @ApiPropertyOptional({ example: 3, description: '對應路段；調查結果會回寫它的 PCI' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SEGMENT_ID?: number;

  @ApiPropertyOptional({ example: 12.5, description: '鋪面厚度(公分)，鑽心取樣才有' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  THICKNESS_CM?: number;

  @ApiPropertyOptional({ example: 65.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI?: number;

  @ApiPropertyOptional({ example: 3.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  IRI?: number;

  @ApiPropertyOptional({ enum: SURVEY_CASE_STATE, example: 'DONE' })
  @IsOptional()
  @IsIn(SURVEY_CASE_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: 'survey/5.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  PHOTO_KEY?: string;

  @ApiPropertyOptional({ example: '面層厚度不足，建議整段刨鋪' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  FINDING?: string;
}
