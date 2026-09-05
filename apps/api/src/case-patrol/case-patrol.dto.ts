import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxDate,
  MaxLength,
  Min,
  ValidateIf
} from 'class-validator';
import { CASE_SOURCE } from './entities/patrol-case.entity';
import { CASE_STATUS_DEF, CRACK_TYPE_DEF, DEGREE_DEF, NEED_REPAIR_DEF, CASE_EDITED_DEF } from '@road-patrol/shared';

const CRACK_KEYS = CRACK_TYPE_DEF.map((c) => c.key);
const DEGREE_KEYS = DEGREE_DEF.map((d) => d.key);
const STATUS_VALUES = CASE_STATUS_DEF.map((s) => s.value);
const EDITED_VALUES = CASE_EDITED_DEF.map((s) => s.value);
const NEED_REPAIR_VALUES = NEED_REPAIR_DEF.map((s) => s.value);

/** 逗號字串或陣列都接受：查詢字串沒有陣列型別 */
export const ToArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : String(value).split(',').filter((v) => v !== '');
  });

/** 數字陣列：狀態是 int，逗號字串要轉成數字才比對得到 */
export const ToNumberArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const arr = Array.isArray(value) ? value : String(value).split(',');
    return arr.filter((v) => v !== '').map(Number);
  });

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';

// ═══ 新增案件（車機／App 上傳）═══════════════════════════════════

/** 上傳的共同欄位：時間、標案、車輛、座標 */
class BaseReceiveDto {
  @ApiProperty({ example: '2026-08-29T09:12:00.123+08:00', description: '車機記錄時間，毫秒精度；不可為未來時間' })
  @Type(() => Date)
  @MaxDate(() => new Date(Date.now() + 10 * 60 * 1000), { message: 'DT_RECORD 不可晚於現在' })
  DT_RECORD!: Date;

  @ApiProperty({ example: 'DEMO01', maxLength: 10, description: '標案號' })
  @IsString()
  @MaxLength(10)
  PRJ_ID!: string;

  @ApiProperty({ example: 'DEMO-001', maxLength: 20, description: '車號' })
  @IsString()
  @MaxLength(20)
  CAR!: string;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiPropertyOptional({ example: 45.2, description: '海拔(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ALTITUDE?: number;
}

export class AddCaseDto extends BaseReceiveDto {
  @ApiProperty({ example: 'TXG-20260829-000123', maxLength: 60, description: '上游系統的識別碼，重送時值必須一致' })
  @IsString()
  @Length(1, 60)
  EXTERNAL_ID!: string;

  @ApiProperty({ enum: CRACK_KEYS, example: 'Potholes', description: '破壞類型' })
  @IsIn(CRACK_KEYS)
  CRACK_TYPE!: string;

  @ApiProperty({ enum: DEGREE_KEYS, example: 'A', description: '破壞程度：A 嚴重 / B 中等 / C 輕微' })
  @IsIn(DEGREE_KEYS)
  DEGREE!: string;

  @ApiPropertyOptional({ example: 0, description: '同一張影像上的第幾個破壞；與時間、影像共同構成唯一鍵', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  CRACK_ID?: number;

  @ApiProperty({ example: 0.7, description: '破壞長度(m)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  LENGTH!: number;

  @ApiProperty({ example: 0.5, description: '破壞寬度(m)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WIDTH!: number;

  @ApiProperty({ example: 0.35, description: '破壞面積(m²)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  AREA!: number;

  @ApiPropertyOptional({ example: 8, description: '破壞深度(cm)；坑洞深度決定工法' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DEPTH?: number;

  @ApiPropertyOptional({ enum: CASE_SOURCE, example: 'VEHICLE', default: 'VEHICLE' })
  @IsOptional()
  @IsIn(CASE_SOURCE as unknown as string[])
  SOURCE?: string;

  @ApiPropertyOptional({ example: 'cases/TXG-20260829-000123.jpg', maxLength: 255, description: '原始影像 key' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  IMG?: string;

  @ApiPropertyOptional({ example: 'cases/TXG-20260829-000123_detect.jpg', maxLength: 255, description: 'AI 標註後的影像 key' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  IMG_DETECT?: string;

  @ApiPropertyOptional({ example: '120,340,260,480', maxLength: 50, description: '破壞在影像上的像素框，供前端畫框' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  IMG_MAP_AREA?: string;

  @ApiPropertyOptional({ example: 128, description: '車機當日流水序號，對帳用' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SERIAL_NO?: number;

  @ApiPropertyOptional({ example: '/sdcard/patrol/20260829/0128.jpg', maxLength: 255, description: '影像在車機上的原始路徑' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  PATH?: string;

  @ApiPropertyOptional({ example: '路口前 5 公尺，車流量大', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  REMARK?: string;
}

// ═══ 查詢條件 ═══════════════════════════════════════════════════

/** 時間區間 */
class DateRangeDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: '記錄時間(起)' })
  @IsOptional()
  @IsDateString()
  START_DATE?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: '記錄時間(迄)，含當日' })
  @IsOptional()
  @IsDateString()
  END_DATE?: string;
}

/** 案件編號 */
class CaseNumDto {
  @ApiPropertyOptional({ example: 'DEMO01PC2608', maxLength: 30, description: '案件編號，支援前綴比對' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  CASE_NUM?: string;

  @ApiPropertyOptional({ example: 'TXG-2026', maxLength: 60, description: '上游識別碼，部分比對' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  EXTERNAL_ID?: string;
}

/** 破壞條件 */
class CrackQueryDto {
  @ApiPropertyOptional({ enum: CRACK_KEYS, isArray: true, description: '破壞類型，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(CRACK_KEYS, { each: true })
  CRACK_TYPE?: string[];

  @ApiPropertyOptional({ enum: DEGREE_KEYS, isArray: true, description: '破壞程度，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(DEGREE_KEYS, { each: true })
  DEGREE?: string[];

  @ApiPropertyOptional({ example: 0.1, description: '面積下限(m²)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  AREA_MIN?: number;

  @ApiPropertyOptional({ example: 5, description: '面積上限(m²)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  AREA_MAX?: number;

  @ApiPropertyOptional({ example: 3, description: '深度下限(cm)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DEPTH_MIN?: number;
}

/** 地址條件 */
class AddressQueryDto {
  @ApiPropertyOptional({ example: '臺中市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: [1], isArray: true, description: '工務段；轄區由「標案-工務段」的行政區推得，不是案件上的欄位' })
  @IsOptional()
  @ToNumberArray()
  @IsInt({ each: true })
  SECTION_ID?: number[];

  @ApiPropertyOptional({ example: '西屯區', isArray: true, description: '行政區，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  DISTRICT?: string[];

  @ApiPropertyOptional({ example: '何厝里', maxLength: 10, description: '里別' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  CAVLGE?: string;

  @ApiPropertyOptional({ example: '臺灣大道', maxLength: 100, description: '道路，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD?: string;

  @ApiPropertyOptional({ example: '99號', maxLength: 100, description: '地址，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ADDRESS?: string;
}

/** 狀態條件：三組狀態各自獨立 */
class StatusQueryDto {
  @ApiPropertyOptional({ enum: STATUS_VALUES, isArray: true, description: '二篩狀態：0 未篩 / 1 通過 / 2 待審 / 3 刪除 / 4 誤判' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(STATUS_VALUES, { each: true })
  STATUS?: number[];

  @ApiPropertyOptional({ enum: EDITED_VALUES, isArray: true, description: '編輯狀態：0 未編輯 / 1 已編輯 / 2 刪除' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(EDITED_VALUES, { each: true })
  EDITED?: number[];

  @ApiPropertyOptional({ enum: NEED_REPAIR_VALUES, isArray: true, description: '需修復狀態：-1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工' })
  @IsOptional()
  @ToNumberArray()
  @IsIn(NEED_REPAIR_VALUES, { each: true })
  NEED_REPAIR?: number[];
}

/** 其他條件 */
class OtherQueryDto {
  @ApiPropertyOptional({ example: 'DEMO01', isArray: true, description: '標案號，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  PRJ_ID?: string[];

  @ApiPropertyOptional({ example: 'DEMO-001', maxLength: 20, description: '車號' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  CAR?: string;

  @ApiPropertyOptional({ enum: CASE_SOURCE, isArray: true, description: '案件來源，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(CASE_SOURCE as unknown as string[], { each: true })
  SOURCE?: string[];

  @ApiPropertyOptional({ example: true, description: '只看還沒派工的案件' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  UNDISPATCHED?: boolean;

  @ApiPropertyOptional({ example: true, description: '只看有照片的案件' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  HAS_IMAGE?: boolean;

  @ApiPropertyOptional({ example: '坑洞', maxLength: 50, description: '關鍵字：同時比對道路、地址、備註、案件編號' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  KEYWORD?: string;
}

/** 分頁與排序 */
class PageDto {
  @ApiPropertyOptional({ example: 'DT_RECORD', enum: ['DT_RECORD', 'AREA', 'DEGREE', 'STATUS', 'CASE_NUM'], default: 'DT_RECORD' })
  @IsOptional()
  @IsIn(['DT_RECORD', 'AREA', 'DEGREE', 'STATUS', 'CASE_NUM'])
  SORT_BY?: string = 'DT_RECORD';

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

/**
 * 案件查詢。
 *
 * 用組合而不是一個大類別：同樣的條件組會出現在查詢、統計、報表三個地方，
 * 各寫一份的話「日期區間」會有三種不同的行為。
 */
export class CaseQueryDto extends IntersectionType(
  DateRangeDto,
  CaseNumDto,
  CrackQueryDto,
  AddressQueryDto,
  StatusQueryDto,
  OtherQueryDto,
  PageDto
) {}

/** 統計查詢：不需要分頁，但多一個分組維度 */
export class CaseStatsQueryDto extends IntersectionType(DateRangeDto, CrackQueryDto, AddressQueryDto, StatusQueryDto, OtherQueryDto) {
  @ApiPropertyOptional({
    example: 'DAY',
    enum: ['DAY', 'WEEK', 'MONTH', 'DISTRICT', 'CAVLGE', 'ROAD', 'CRACK_TYPE', 'DEGREE', 'CAR', 'PRJ_ID'],
    default: 'DAY',
    description: '統計維度'
  })
  @IsOptional()
  @IsIn(['DAY', 'WEEK', 'MONTH', 'DISTRICT', 'CAVLGE', 'ROAD', 'CRACK_TYPE', 'DEGREE', 'CAR', 'PRJ_ID'])
  GROUP_BY?: string = 'DAY';
}

// ═══ 更新 ═══════════════════════════════════════════════════════

class EntityIdDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  ID!: number;
}

/** 可修改的案件欄位；複查後修正用 */
class CaseEditableDto {
  @ApiPropertyOptional({ enum: CRACK_KEYS })
  @IsOptional()
  @IsIn(CRACK_KEYS)
  CRACK_TYPE?: string;

  @ApiPropertyOptional({ enum: DEGREE_KEYS })
  @IsOptional()
  @IsIn(DEGREE_KEYS)
  DEGREE?: string;

  @ApiPropertyOptional({ example: 0.7, description: '破壞長度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  LENGTH?: number;

  @ApiPropertyOptional({ example: 0.5, description: '破壞寬度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WIDTH?: number;

  @ApiPropertyOptional({ example: 0.35, description: '破壞面積(m²)；會進報表與計價' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  AREA?: number;

  @ApiPropertyOptional({ example: 8, description: '破壞深度(cm)；決定工法' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DEPTH?: number;

  @ApiPropertyOptional({ example: 1, description: '所屬標案' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '複查後調整為高風險', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  REMARK?: string;
}

/**
 * 可修改的地址欄位。
 *
 * 與查詢的地址條件長得很像但不共用：查詢的行政區是多選(要一次看好幾區)，
 * 修改的行政區只會是一個。共用一個 DTO 的話，更新端點會收到一個陣列，
 * 然後只能取第一個 —— 那是介面在說謊。
 */
class AddressEditableDto {
  @ApiPropertyOptional({ example: '臺中市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;

  @ApiPropertyOptional({ example: '何厝里', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  CAVLGE?: string;

  @ApiPropertyOptional({ example: '臺灣大道三段', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD?: string;

  @ApiPropertyOptional({ example: '臺灣大道三段99號', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  ADDRESS?: string;
}

/** 更新案件欄位（複查後修正）；地址欄位一併可改，逆地理編碼有時會判錯 */
export class UpdateCaseDto extends IntersectionType(EntityIdDto, CaseEditableDto, AddressEditableDto) {}

/**
 * 更新狀態。
 *
 * 三組狀態分開更新 —— 二篩通過不代表要修，要修也不代表已經派工。
 * 一次只送要改的那一組，沒送的維持原值。
 */
export class UpdateCaseStatusDto extends EntityIdDto {
  @ApiPropertyOptional({ enum: STATUS_VALUES, example: 1, description: '二篩狀態' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(STATUS_VALUES)
  STATUS?: number;

  @ApiPropertyOptional({ enum: NEED_REPAIR_VALUES, example: 2, description: '需修復狀態' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(NEED_REPAIR_VALUES)
  NEED_REPAIR?: number;

  @ApiPropertyOptional({ example: true, description: '以管理者身分覆核（另外記一組時間與人）' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  AS_ADMIN?: boolean;

  @ApiPropertyOptional({ example: '現場複查無破壞', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  REMARK?: string;
}

/** 批次更新狀態：二篩是一批一批做的，一筆一筆送會很慢 */
export class BatchUpdateStatusDto {
  @ApiProperty({ example: [12, 13, 14], type: [Number], description: '案件 id 陣列' })
  @ToNumberArray()
  @IsInt({ each: true })
  IDS!: number[];

  @ApiPropertyOptional({ enum: STATUS_VALUES, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(STATUS_VALUES)
  STATUS?: number;

  @ApiPropertyOptional({ enum: NEED_REPAIR_VALUES, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(NEED_REPAIR_VALUES)
  NEED_REPAIR?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  AS_ADMIN?: boolean;
}

export class NearbyQueryDto {
  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiPropertyOptional({ example: 500, default: 500, description: '半徑(公尺)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  RADIUS_M?: number = 500;
}
