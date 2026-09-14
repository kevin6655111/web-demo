import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf
} from 'class-validator';
import { ToArray, ToNumberArray } from '@/case-patrol/case-patrol.dto';
import {
  CRACK_TYPE_DEF,
  DEGREE_DEF,
  IMAGE_TYPE_DEF,
  MAINTENANCE_STATUS_DEF,
  MAINTENANCE_TYPE_DEF,
  MATERIAL_DEF,
  PERIOD_DEF,
  WEATHER_DEF,
  WORK_ORDER_ACTION
} from '@road-patrol/shared';

const TYPE_KEYS = MAINTENANCE_TYPE_DEF.map((t) => t.key);
const STATUS_VALUES = MAINTENANCE_STATUS_DEF.map((s) => s.value);
const DTYPE_KEYS = CRACK_TYPE_DEF.map((c) => c.key);
const DEGREE_KEYS = DEGREE_DEF.map((d) => d.key);
const MATERIAL_KEYS = MATERIAL_DEF.map((m) => m.key);
const PERIOD_KEYS = PERIOD_DEF.map((p) => p.key);
const WEATHER_KEYS = WEATHER_DEF.map((w) => w.key);
const IMAGE_TYPES = IMAGE_TYPE_DEF.map((i) => i.type);

/** 狀態端點吃得下的值：真實狀態 + 兩個動作碼 */
const STATUS_OR_ACTION = [...STATUS_VALUES, WORK_ORDER_ACTION.RESTORE];

const toBool = () =>
  Transform(({ value }) => {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

// ═══ 欄位群組 ═══════════════════════════════════════════════════

/** 表單類型 */
class MaintenanceTypeDto {
  @ApiProperty({ enum: TYPE_KEYS, example: 'RA', description: '巡查單類型：RA 巡查（只記錄）/ RB 巡修（當場修掉）' })
  @IsIn(TYPE_KEYS)
  TYPE!: string;
}

/** 調查資訊 */
class SurveyInfoDto {
  @ApiProperty({ example: 'DEMO01', maxLength: 10, description: '標案號' })
  @IsString()
  @MaxLength(10)
  PRJ_ID!: string;

  @ApiProperty({ example: '2026-09-01', description: '調查日期' })
  @IsDateString()
  SURVEY_DATE!: string;

  @ApiPropertyOptional({ enum: PERIOD_KEYS, example: 'AM', description: '調查時段' })
  @IsOptional()
  @IsIn(PERIOD_KEYS)
  PERIOD?: string;

  @ApiPropertyOptional({ enum: WEATHER_KEYS, example: '晴', description: '天氣；雨天的判定基準與晴天不同' })
  @IsOptional()
  @IsIn(WEATHER_KEYS)
  WEATHER?: string;
}

/** 破壞內容 */
class DamageDto {
  @ApiPropertyOptional({ enum: DTYPE_KEYS, example: 'Potholes', description: '破壞類型，沿用判讀模型的 key' })
  @IsOptional()
  @IsIn(DTYPE_KEYS)
  DTYPE?: string;

  @ApiPropertyOptional({ enum: DEGREE_KEYS, example: 'B', description: '嚴重程度：A 最嚴重' })
  @IsOptional()
  @IsIn(DEGREE_KEYS)
  DEGREE?: string;

  @ApiPropertyOptional({ example: 1.2, description: '破壞長度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DTYPE_LENGTH?: number;

  @ApiPropertyOptional({ example: 0.8, description: '破壞寬度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DTYPE_WIDTH?: number;
}

/** 地點 */
class MaintenancePlaceDto {
  @ApiPropertyOptional({ example: '臺中市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiProperty({ example: '西屯區', maxLength: 10, description: '行政區' })
  @IsString()
  @MaxLength(10)
  DISTRICT!: string;

  @ApiPropertyOptional({ example: '何厝里', maxLength: 10, description: '里別' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  CAVLGE?: string;

  @ApiProperty({ example: '臺灣大道三段99號', maxLength: 100, description: '破壞地址' })
  @IsString()
  @MaxLength(100)
  ADDRESS!: string;

  @ApiProperty({ example: 120.6478, description: '經度' })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1789, description: '緯度' })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiPropertyOptional({ example: '積水處，雨後再看一次', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  REMARK?: string;
}

/**
 * 巡修內容：只有 RB 需要。
 *
 * 材料必填 —— 「當場修掉了」而不寫用了什麼，計價時無從對帳。
 */
class RepairDto {
  @ApiPropertyOptional({ enum: MATERIAL_KEYS, example: 'COLD', description: '施工材料；TYPE=RB 時必填' })
  @ValidateIf((o) => o.TYPE === 'RB')
  @IsDefined({ message: 'TYPE=RB 時 MATERIAL 必填' })
  @IsIn(MATERIAL_KEYS)
  MATERIAL?: string;

  @ApiPropertyOptional({ example: 1.5, description: '回填長度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  REFILL_LENGTH?: number;

  @ApiPropertyOptional({ example: 1.0, description: '回填寬度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  REFILL_WIDTH?: number;

  @ApiPropertyOptional({ example: 3, description: '用料數量（包／立方，依材料別）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  QUANTITY?: number;
}

// ═══ 建立與更新 ═════════════════════════════════════════════════

export class AddMaintenanceDto extends IntersectionType(
  MaintenanceTypeDto,
  SurveyInfoDto,
  DamageDto,
  MaintenancePlaceDto,
  RepairDto
) {}

class MaintenanceIdDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  ID!: number;
}

/**
 * 更新巡查單。
 *
 * 類型**可以**改 —— 與派工單不同：巡查員在現場常是先開 RA，
 * 材料到了才當場補起來變成 RB。改回 RA 時巡修欄位會一併移除。
 */
export class UpdateMaintenanceDto extends IntersectionType(
  MaintenanceIdDto,
  PartialType(IntersectionType(MaintenanceTypeDto, SurveyInfoDto, DamageDto, MaintenancePlaceDto, RepairDto))
) {}

/**
 * 批次更新狀態。
 *
 * 一次收一組 id：現場一趟巡查會開十幾張單，逐張按十幾次是沒有人會做的事。
 * 不能改的那幾筆會被跳過並附上原因，而不是整批失敗。
 */
export class UpdateMaintenanceStatusDto {
  @ApiProperty({ example: [5, 6], isArray: true, description: '巡查單 id，可多筆' })
  @ToNumberArray()
  @IsInt({ each: true })
  ID!: number[];

  @ApiProperty({
    enum: STATUS_OR_ACTION,
    example: 1,
    description: '-1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工；8 為復原（回到歷程上一個不同的狀態）'
  })
  @Type(() => Number)
  @IsIn(STATUS_OR_ACTION)
  STATUS!: number;
}

// ═══ 查詢 ═══════════════════════════════════════════════════════

export class MaintenanceQueryDto {
  @ApiPropertyOptional({ example: 'DEMO01RA2609', maxLength: 30, description: '巡查單號，支援前綴比對' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  CASE_NUM?: string;

  @ApiPropertyOptional({ enum: TYPE_KEYS, isArray: true, description: '表單類型，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(TYPE_KEYS, { each: true })
  TYPE?: string[];

  @ApiPropertyOptional({ enum: STATUS_VALUES, isArray: true, description: '狀態，可多選' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(STATUS_VALUES, { each: true })
  STATUS?: number[];

  @ApiPropertyOptional({ example: 'DEMO01', isArray: true, description: '標案號，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  PRJ_ID?: string[];

  @ApiPropertyOptional({ example: '2026-09-01', description: '調查日期(起)' })
  @IsOptional()
  @IsDateString()
  START_DATE?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: '調查日期(迄)' })
  @IsOptional()
  @IsDateString()
  END_DATE?: string;

  @ApiPropertyOptional({ enum: DTYPE_KEYS, isArray: true, description: '破壞類型，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(DTYPE_KEYS, { each: true })
  DTYPE?: string[];

  @ApiPropertyOptional({ enum: DEGREE_KEYS, isArray: true, description: '嚴重程度，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(DEGREE_KEYS, { each: true })
  DEGREE?: string[];

  @ApiPropertyOptional({ example: '西屯區', isArray: true, description: '行政區，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  DISTRICT?: string[];

  @ApiPropertyOptional({ example: '何厝里', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  CAVLGE?: string;

  @ApiPropertyOptional({ example: 4, description: '調查人員的使用者 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SURVEY_USER_ID?: number;

  @ApiPropertyOptional({ example: '臺灣大道', maxLength: 50, description: '關鍵字：比對單號、地址、備註' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  KEYWORD?: string;

  @ApiPropertyOptional({ example: true, description: '只看還沒開出派工單的（待派工清單）' })
  @IsOptional()
  @toBool()
  @IsBoolean()
  NO_ORDER?: boolean;

  @ApiPropertyOptional({ example: 'SURVEY_DATE', enum: ['SURVEY_DATE', 'CASE_NUM', 'STATUS'], default: 'SURVEY_DATE' })
  @IsOptional()
  @IsIn(['SURVEY_DATE', 'CASE_NUM', 'STATUS'])
  SORT_BY?: string = 'SURVEY_DATE';

  @ApiPropertyOptional({ example: 'DESC', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  SORT_DIR?: string = 'DESC';

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

// ═══ 照片 ═══════════════════════════════════════════════════════

export class DeleteMaintenanceImageDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ enum: IMAGE_TYPES, example: 'IMG' })
  @IsIn(IMAGE_TYPES)
  IMG_TYPE!: string;
}
