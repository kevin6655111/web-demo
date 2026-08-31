import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { CASE_TYPE } from './entities/case-history.entity';

/** 四種實體共用同一套歷程 API，用這個欄位指定看的是哪一種 */
export class CaseTypeDto {
  @ApiProperty({ enum: CASE_TYPE, example: 'CASE_PATROL', description: '實體類型：破壞案件／派工單／標案／檢測案件' })
  @IsIn(CASE_TYPE as unknown as string[])
  CASE_TYPE!: string;
}

export class RestoreCaseDto extends CaseTypeDto {
  @ApiProperty({ example: 12, description: '實體 id' })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ example: 2, description: '要還原到的版本號' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  VERSION!: number;
}

export class CompareVersionDto extends CaseTypeDto {
  @ApiProperty({ example: 1, description: '基準版本' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  FROM!: number;

  @ApiProperty({ example: 3, description: '比較版本' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  TO!: number;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ enum: CASE_TYPE, description: '不指定則跨所有類型查' })
  @IsOptional()
  @IsIn(CASE_TYPE as unknown as string[])
  CASE_TYPE?: string;

  @ApiPropertyOptional({ example: 3, description: '只看某個人做的變更' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  OPERATOR_ID?: number;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;
}
