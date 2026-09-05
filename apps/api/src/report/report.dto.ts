import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { REPORT_FORMAT } from './entities/report-job.entity';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, NEED_REPAIR_DEF } from '@road-patrol/shared';

export class CreateReportDto {
  @ApiProperty({ enum: REPORT_FORMAT, example: 'XLSX', description: 'XLSX 給資料分析、DOCX 給正式函文' })
  @IsIn(REPORT_FORMAT as unknown as string[])
  FORMAT!: string;

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

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10, description: '行政區' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;
}

export class ReportIdDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ID!: number;
}
