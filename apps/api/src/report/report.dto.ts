import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { REPORT_FORMAT } from './entities/report-job.entity';
import { REPORT_KIND_DEF, keysOf } from '@road-patrol/shared';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, NEED_REPAIR_DEF } from '@road-patrol/shared';

const REPORT_KINDS = keysOf(REPORT_KIND_DEF as unknown as readonly { key: string; name: string }[]);

/**
 * 報表參數。
 *
 * 每一種報表接受的鍵不同，但**不為每一種各開一個 DTO** ——
 * 十一種報表就是十一個幾乎一樣的類別，而它們的差異
 * (`MONTH` 還是 `DAY`、要不要 `ORDER_ID`)已經宣告在 `REPORT_KIND_DEF.params` 裡。
 *
 * 所以這裡把所有可能的參數列成選填，由服務層依種類檢查必填的那幾個。
 * 這樣做的代價是「送錯參數不會在驗證層被擋下」，換來的是新增一種報表
 * 不必動 DTO —— 而錯的參數在服務層會得到一句說得清楚的話。
 */
export class CreateReportDto {
  @ApiProperty({ enum: REPORT_KINDS, example: 'CASE_LIST', description: '報表種類；決定資料來源與版面' })
  @IsIn(REPORT_KINDS)
  KIND!: string;

  @ApiProperty({ enum: REPORT_FORMAT, example: 'XLSX', description: 'XLSX 給資料分析、DOCX 給正式函文' })
  @IsIn(REPORT_FORMAT as unknown as string[])
  FORMAT!: string;

  // ─── 期間 ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: '2026-08-01', description: '起日；CASE_LIST / POTHOLE / TRACK 用' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: '迄日，含當日' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;

  @ApiPropertyOptional({ example: '2026-08-29', description: '指定單日；DAILY 用' })
  @IsOptional()
  @IsDateString()
  DAY?: string;

  @ApiPropertyOptional({ example: '2026-08', description: '結算月份 YYYY-MM；MONTHLY / SALARY 用' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'MONTH 格式應為 YYYY-MM' })
  MONTH?: string;

  // ─── 範圍 ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'DEMO01', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  PRJ_ID?: string;

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

  @ApiPropertyOptional({ example: 1, description: '車輛；TRACK 用' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  VEHICLE_ID?: number;

  @ApiPropertyOptional({ example: 3, description: '判讀員；SALARY 用' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  USER_ID?: number;

  @ApiPropertyOptional({ example: 1, description: '委託單；四種鋪面報表用' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ORDER_ID?: number;

  // ─── 案件條件 ───────────────────────────────────────────────────

  @ApiPropertyOptional({ enum: CASE_STATUS_DEF.map((s) => s.value), description: '二篩狀態' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(CASE_STATUS_DEF.map((s) => s.value))
  STATUS?: number;

  @ApiPropertyOptional({ enum: NEED_REPAIR_DEF.map((s) => s.value), description: '修繕狀態' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(NEED_REPAIR_DEF.map((s) => s.value))
  NEED_REPAIR?: number;

  @ApiPropertyOptional({ enum: CRACK_TYPE_DEF.map((c) => c.key), description: '破壞類型' })
  @IsOptional()
  @IsIn(CRACK_TYPE_DEF.map((c) => c.key))
  CRACK_TYPE?: string;

  @ApiPropertyOptional({ example: 'POOR', description: '養護等級；ROAD_EVAL 用' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  MAINTAIN_LEVEL?: string;
}

export class ReportIdDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ID!: number;
}

export class ReportQueryDto {
  @ApiPropertyOptional({ enum: REPORT_KINDS, description: '只看某一種報表' })
  @IsOptional()
  @IsIn(REPORT_KINDS)
  KIND?: string;
}
