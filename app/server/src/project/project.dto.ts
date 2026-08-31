import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PROJECT_STATE } from './entities/project.entity';
import { ToArray, ToNumberArray } from '@/case-patrol/case-patrol.dto';

export class ProjectQueryDto {
  @ApiPropertyOptional({ example: 'DEMO01', maxLength: 10, description: '標案號，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  PRJ_ID?: string;

  @ApiPropertyOptional({ example: '巡查', maxLength: 50, description: '關鍵字：比對標案名稱與業主' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  KEYWORD?: string;

  @ApiPropertyOptional({ enum: PROJECT_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(PROJECT_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ example: [2, 3], isArray: true, description: '業主等級：1 中央 / 2 直轄市 / 3 縣市 / 4 鄉鎮' })
  @IsOptional()
  @ToNumberArray()
  @IsInt({ each: true })
  PROPRIETOR_LEVEL?: number[];

  @ApiPropertyOptional({ example: '2026-01-01', description: '執行期間有交集的起日' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;

  @ApiPropertyOptional({ example: true, description: '只看今天在執行期間內的標案' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  CURRENT?: boolean;
}

export class CreateProjectDto {
  @ApiProperty({ example: 'DEMO02', maxLength: 10, description: '標案號：進案件編號的短代碼' })
  @IsString()
  @Length(1, 10)
  PRJ_ID!: string;

  @ApiPropertyOptional({ example: '1140829-001', maxLength: 30, description: '招標文件上的正式編號' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  PRJ_NO?: string;

  @ApiProperty({ example: '116 年度市區道路巡查', maxLength: 50, description: '標案簡稱' })
  @IsString()
  @MaxLength(50)
  PRJ_NAME!: string;

  @ApiProperty({ example: '116 年度市區道路巡查維護暨即時通報系統委外服務案', maxLength: 100, description: '標案全名' })
  @IsString()
  @MaxLength(100)
  PRJ_MAIN!: string;

  @ApiPropertyOptional({ example: '第一標', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  PRJ_SUB?: string;

  @ApiProperty({ example: '示範市政府建設局', maxLength: 30, description: '業主' })
  @IsString()
  @MaxLength(30)
  PROPRIETOR!: string;

  @ApiPropertyOptional({ example: 2, description: '業主等級：1 中央 / 2 直轄市 / 3 縣市 / 4 鄉鎮；影響報表格式與上傳規則', default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  PROPRIETOR_LEVEL?: number;

  @ApiProperty({ example: '2027-01-01' })
  @IsDateString()
  START_DATE!: string;

  @ApiProperty({ example: '2027-12-31' })
  @IsDateString()
  END_DATE!: string;

  @ApiPropertyOptional({ example: 12000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  BUDGET?: number;

  @ApiPropertyOptional({ example: 320.5, description: '巡查里程(km)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ROAD_KM?: number;
}

export class UpdateProjectStateDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ enum: PROJECT_STATE, example: 'ACTIVE' })
  @IsIn(PROJECT_STATE as unknown as string[])
  STATE!: string;
}

/**
 * 維護標案關聯。
 *
 * 三種關聯共用一支端點：它們的形狀一樣（標案 + 對象 + 啟用與否），
 * 拆成三支只會讓前端多記三個路徑。
 */
export class UpsertProjectRelationDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  PROJECT_ID!: number;

  @ApiProperty({ enum: ['COMPANY', 'VEHICLE', 'SECTION'], example: 'VEHICLE', description: '關聯類型' })
  @IsIn(['COMPANY', 'VEHICLE', 'SECTION'])
  KIND!: string;

  @ApiProperty({ example: 3, description: '對象 id：公司／車輛／工務段' })
  @Type(() => Number)
  @IsInt()
  TARGET_ID!: number;

  @ApiPropertyOptional({ enum: ['MAIN', 'SUB'], example: 'SUB', description: '公司角色：主辦或協力；KIND=COMPANY 時有效' })
  @IsOptional()
  @IsIn(['MAIN', 'SUB'])
  ROLE?: string;

  @ApiPropertyOptional({ example: [1, 2], isArray: true, description: '轄區行政區 id；KIND=SECTION 時有效' })
  @IsOptional()
  @ToNumberArray()
  @IsInt({ each: true })
  AREA_IDS?: number[];

  @ApiPropertyOptional({ example: true, description: '停用而非刪除：歷史資料仍要查得到當時的關聯', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  IS_ACTIVE?: boolean;
}
