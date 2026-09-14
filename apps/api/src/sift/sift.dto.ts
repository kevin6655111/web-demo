import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, DEGREE_DEF, SIFT_PAGE_DEF, keysOf } from '@road-patrol/shared';
import { ToArray, ToNumberArray } from '@/case-patrol/case-patrol.dto';

const SIFT_PAGES = keysOf(SIFT_PAGE_DEF);
const CRACK_KEYS = CRACK_TYPE_DEF.map((c) => c.key);
const DEGREE_KEYS = DEGREE_DEF.map((d) => d.key);
const STATUS_VALUES = CASE_STATUS_DEF.map((s) => s.value);

/** 可以「判定」成什麼：通過、誤判、刪除。未審與待審是流程狀態，不是判定結果 */
export const JUDGE_VALUES = [1, 3, 4] as const;

/** 二篩共用的範圍條件；判讀、覆核、統計、薪資都用同一組 */
class SiftScopeDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  START_DATE?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: '含當日' })
  @IsOptional()
  @IsDateString()
  END_DATE?: string;

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

  @ApiPropertyOptional({ example: 'DEMO01', isArray: true })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  PRJ_ID?: string[];

  @ApiPropertyOptional({ example: 'DEMO-001', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  CAR?: string;

  @ApiPropertyOptional({ enum: CRACK_KEYS, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(CRACK_KEYS, { each: true })
  CRACK_TYPE?: string[];

  @ApiPropertyOptional({ enum: DEGREE_KEYS, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(DEGREE_KEYS, { each: true })
  DEGREE?: string[];
}

class SiftPageDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PAGE?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  SIZE?: number = 50;
}

/**
 * 二篩清單。
 *
 * `TYPE` 決定看誰的結果：
 *   GENERAL 判讀員看還沒判的(未審、待審)
 *   MANAGE  管理者看已經判過的，準備覆核
 * 這兩種預設狀態不同，但條件與欄位完全一樣，所以是同一支端點。
 */
export class SiftQueryDto extends IntersectionType(SiftScopeDto, SiftPageDto) {
  @ApiPropertyOptional({ enum: SIFT_PAGES, example: 'GENERAL', default: 'GENERAL' })
  @IsOptional()
  @IsIn(SIFT_PAGES)
  TYPE?: string = 'GENERAL';

  @ApiPropertyOptional({ enum: STATUS_VALUES, isArray: true, description: '覆寫預設的狀態範圍' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(STATUS_VALUES, { each: true })
  STATUS?: number[];

  @ApiPropertyOptional({ example: 3, description: '只看某位判讀員判的(覆核時用)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  JUDGED_BY?: number;

  @ApiPropertyOptional({ example: true, description: '只看還沒被覆核的' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  UNREVIEWED?: boolean;
}

/** 判定：判讀員的動作 */
export class JudgeCaseDto {
  @ApiProperty({ example: [12, 13], type: [Number], description: '案件 id' })
  @ToNumberArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiProperty({ enum: JUDGE_VALUES, example: 1, description: '1 通過 / 3 刪除 / 4 誤判' })
  @Type(() => Number)
  @IsIn(JUDGE_VALUES as unknown as number[])
  STATUS!: number;

  @ApiPropertyOptional({ example: '路面反光造成誤判', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

/** 覆核：管理者的動作。可以維持也可以推翻判讀員的結果 */
export class ReviewCaseDto extends JudgeCaseDto {}

export class SiftStatsQueryDto extends SiftScopeDto {
  @ApiPropertyOptional({
    example: 'USER',
    enum: ['DAY', 'USER', 'COUNTY', 'DISTRICT', 'CRACK_TYPE'],
    default: 'USER'
  })
  @IsOptional()
  @IsIn(['DAY', 'USER', 'COUNTY', 'DISTRICT', 'CRACK_TYPE'])
  GROUP_BY?: string = 'USER';
}

/** 薪資表：一個月結算一次 */
export class SiftSalaryQueryDto {
  @ApiProperty({ example: '2026-08', description: '結算月份 YYYY-MM' })
  @IsString()
  @MaxLength(7)
  MONTH!: string;

  @ApiPropertyOptional({ example: 3, description: '只看某一位' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  USER_ID?: number;
}
