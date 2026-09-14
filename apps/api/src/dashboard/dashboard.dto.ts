import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** 每日檢查：督導看的是「昨天」，所以預設就是昨天 */
export class DailyCheckQueryDto {
  @ApiPropertyOptional({ example: '2026-09-13', description: '檢查日期；省略時為昨天' })
  @IsOptional()
  @IsDateString()
  DATE?: string;

  @ApiPropertyOptional({ example: 'DEMO-001', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  CAR?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: true, description: '只看有問題的(未出車、無案件、照片缺件)' })
  @IsOptional()
  @Type(() => Boolean)
  ABNORMAL_ONLY?: boolean;
}

/** 結算查詢：看板的歷史區間走這一支，讀統計表而不是即時算 */
export class SettlementQueryDto {
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

  @ApiPropertyOptional({
    example: 'DAY',
    enum: ['DAY', 'DISTRICT', 'PROJECT'],
    default: 'DAY',
    description: '分組維度'
  })
  @IsOptional()
  @IsIn(['DAY', 'DISTRICT', 'PROJECT'])
  GROUP_BY?: string = 'DAY';
}
