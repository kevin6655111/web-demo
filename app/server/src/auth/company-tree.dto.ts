import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { COMPANY_TIER } from './entities/company.entity';
import { ACTION_KEYS } from './constants/module.const';

const TIERS = Object.values(COMPANY_TIER);

export class SubCompanyQueryDto {
  @ApiPropertyOptional({ example: 'SUB', maxLength: 50, description: '關鍵字：比對代碼與名稱' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  KEYWORD?: string;

  @ApiPropertyOptional({ enum: TIERS, example: 3, description: '2 廠商單位 / 3 外包單位' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(TIERS)
  TIER?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ACTIVE?: boolean;
}

export class CreateCompanyDto {
  @ApiProperty({ example: 'SUB01', maxLength: 10, description: '公司代碼；登入時要輸入的那一個' })
  @IsString()
  @Length(2, 10)
  CODE!: string;

  @ApiProperty({ example: '示範外包工程行', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  NAME!: string;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 500, description: '人員額度；開通模組卻不限人數等於沒有限制' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  USER_LIMIT?: number;

  @ApiPropertyOptional({ example: '負責西屯區道路修繕', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  DESCRIPTION?: string;

  @ApiPropertyOptional({
    example: ['CASE.READ', 'WORK_ORDER.READ', 'WORK_ORDER.UPDATE'],
    isArray: true,
    description: '建立時一併開通的動作；必須是自己有的子集'
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ACTION_KEYS as string[], { each: true })
  ACTIONS?: string[];
}

export class UpdateCompanyDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({ example: '示範外包工程行', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  NAME?: string;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  USER_LIMIT?: number;

  @ApiPropertyOptional({ example: '負責西屯區道路修繕', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  DESCRIPTION?: string;

  @ApiPropertyOptional({ example: false, description: '停用而不刪除：合約中止後仍要查得到當時的案件是誰做的' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  IS_ACTIVE?: boolean;
}

export class GrantActionsDto {
  @ApiProperty({ example: 3, description: '要開通的下層單位' })
  @Type(() => Number)
  @IsInt()
  COMPANY_ID!: number;

  @ApiProperty({
    example: ['CASE.READ', 'WORK_ORDER.READ', 'WORK_ORDER.UPDATE'],
    isArray: true,
    description: '開通後應有的**完整**清單（不是增量）；沒列到的會被收回'
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(ACTION_KEYS as string[], { each: true })
  ACTIONS!: string[];
}
