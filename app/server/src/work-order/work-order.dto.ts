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
import { IMAGE_TYPE_DEF, MATERIAL_DEF, TEST_ITEM_DEF, WORK_ORDER_STATUS_DEF, WORK_ORDER_TYPE_DEF } from '@/core/constants/type-def.const';

const TYPE_KEYS = WORK_ORDER_TYPE_DEF.map((t) => t.key);
const STATUS_VALUES = WORK_ORDER_STATUS_DEF.map((s) => s.value);
const MATERIAL_KEYS = MATERIAL_DEF.map((m) => m.key);
const IMAGE_TYPES = IMAGE_TYPE_DEF.map((i) => i.type);

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';
const toBool = () =>
  Transform(({ value }) => {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

// ═══ 派工單的欄位群組 ═══════════════════════════════════════════

/** 表單類型 */
class FormTypeDto {
  @ApiProperty({
    enum: TYPE_KEYS,
    example: 'PA',
    description: '派工單類型：PA 刨除加封 / PB 路基改善 / PC AI車巡 / PD APP巡查'
  })
  @IsIn(TYPE_KEYS)
  TYPE!: string;
}

/** 基本資訊：標案與地點 */
class BaseOrderDto {
  @ApiProperty({ example: 'DEMO01', maxLength: 10, description: '標案號' })
  @IsString()
  @MaxLength(10)
  PRJ_ID!: string;

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

  @ApiProperty({ example: '臺灣大道三段99號', maxLength: 100, description: '施工地點' })
  @IsString()
  @MaxLength(100)
  ADDRESS!: string;

  @ApiPropertyOptional({ example: '人手孔下陷', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  REMARK?: string;
}

/** 施工人員 */
class WorkerDto {
  @ApiPropertyOptional({ example: 4, description: '施工人員的使用者 id；未帶表示尚未指派' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WORKER_USER_ID?: number;
}

/** 日期 */
class OrderDateDto {
  @ApiProperty({ example: '2026-08-29', description: '派工日期' })
  @IsDateString()
  DISPATCH_DATE!: string;

  @ApiPropertyOptional({ example: '2026-09-05', description: '施工期限' })
  @IsOptional()
  @IsDateString()
  DUE_DATE?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: '施工開始日期' })
  @IsOptional()
  @IsDateString()
  WORK_START_DATE?: string;

  @ApiPropertyOptional({ example: '2026-09-02', description: '完工日期' })
  @IsOptional()
  @IsDateString()
  WORK_END_DATE?: string;
}

/** 施工材料與尺寸 */
class DimensionDto {
  @ApiPropertyOptional({ enum: MATERIAL_KEYS, example: 'AC', description: '施工材料' })
  @IsOptional()
  @IsIn(MATERIAL_KEYS)
  MATERIAL?: string;

  @ApiPropertyOptional({ example: 12.5, description: '材料粒徑(mm)；影響單價' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  MATERIAL_SIZE?: number;

  @ApiPropertyOptional({ example: 10.5, description: '施工長度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WORK_LENGTH?: number;

  @ApiPropertyOptional({ example: 3.2, description: '施工寬度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WORK_WIDTH?: number;

  @ApiPropertyOptional({ example: 5, description: '刨除深度(cm)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WORK_DEPTH_MILLING?: number;

  @ApiPropertyOptional({ example: 5, description: '鋪築深度(cm)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  WORK_DEPTH_PAVING?: number;
}

/** 施工起訖點：刨除加封是「一段路」，只存一個座標無法驗收施作範圍 */
class StartEndDto {
  @ApiPropertyOptional({ example: 120.6478, description: '起點經度，需與 START_LAT 同時提供' })
  @ValidateIf((o) => hasValue(o.START_LAT))
  @IsDefined({ message: 'START_LNG 必須與 START_LAT 同時提供' })
  @Type(() => Number)
  @IsLongitude()
  START_LNG?: number;

  @ApiPropertyOptional({ example: 24.1789, description: '起點緯度' })
  @ValidateIf((o) => hasValue(o.START_LNG))
  @IsDefined({ message: 'START_LAT 必須與 START_LNG 同時提供' })
  @Type(() => Number)
  @IsLatitude()
  START_LAT?: number;

  @ApiPropertyOptional({ example: 120.6501, description: '迄點經度' })
  @ValidateIf((o) => hasValue(o.END_LAT))
  @IsDefined({ message: 'END_LNG 必須與 END_LAT 同時提供' })
  @Type(() => Number)
  @IsLongitude()
  END_LNG?: number;

  @ApiPropertyOptional({ example: 24.1802, description: '迄點緯度' })
  @ValidateIf((o) => hasValue(o.END_LNG))
  @IsDefined({ message: 'END_LAT 必須與 END_LNG 同時提供' })
  @Type(() => Number)
  @IsLatitude()
  END_LAT?: number;

  @ApiPropertyOptional({ example: '臺灣大道三段99號', maxLength: 100, description: '施工起點地址' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  START_ADDR?: string;

  @ApiPropertyOptional({ example: '臺灣大道三段199號', maxLength: 100, description: '施工迄點地址' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  END_ADDR?: string;
}

/** 取樣與試驗：只有路基改善(PB)需要 */
class SampleDto {
  @ApiPropertyOptional({ example: true, description: '是否取樣；TYPE=PB 時必填' })
  @ValidateIf((o) => o.TYPE === 'PB')
  @IsDefined({ message: 'TYPE=PB 時 SAMPLE_TAKEN 必填' })
  @toBool()
  @IsBoolean()
  SAMPLE_TAKEN?: boolean;

  @ApiPropertyOptional({ example: '2026-09-01', description: '取樣日期；PB 且有取樣時必填' })
  @ValidateIf((o) => o.TYPE === 'PB' && o.SAMPLE_TAKEN === true)
  @IsDefined({ message: '有取樣時 SAMPLE_DATE 必填' })
  @IsDateString()
  SAMPLE_DATE?: string;

  @ApiPropertyOptional({ enum: TEST_ITEM_DEF, isArray: true, example: ['壓實度', '厚度'], description: '試驗項目；PB 且有取樣時必填' })
  @ValidateIf((o) => o.TYPE === 'PB' && o.SAMPLE_TAKEN === true)
  @IsDefined({ message: '有取樣時 TEST_ITEM 必填' })
  @ToArray()
  @IsIn(TEST_ITEM_DEF as unknown as string[], { each: true })
  TEST_ITEM?: string[];

  @ApiPropertyOptional({ example: '壓實度 96%，符合規範', maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  TEST_RESULT?: string;
}

/** 來源案件：PC 來自車巡、PD 來自巡查單 */
class SourceCaseDto {
  @ApiPropertyOptional({ example: 1024, description: '來源車巡案件 id；TYPE=PC 時必填' })
  @ValidateIf((o) => o.TYPE === 'PC')
  @IsDefined({ message: 'TYPE=PC 時 CASE_PATROL_ID 必填' })
  @Type(() => Number)
  @IsInt()
  CASE_PATROL_ID?: number;
}

// ═══ 建立與更新 ═════════════════════════════════════════════════

export class AddWorkOrderDto extends IntersectionType(
  FormTypeDto,
  BaseOrderDto,
  WorkerDto,
  OrderDateDto,
  DimensionDto,
  StartEndDto,
  SampleDto,
  SourceCaseDto
) {}

class OrderIdDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;
}

/**
 * 更新派工單。
 *
 * 類型不可改：PA 與 PB 的必填欄位不同，改類型等於換一張單，
 * 應該作廢重開而不是就地修改 —— 否則歷程會出現一張前後不一致的單。
 */
export class UpdateWorkOrderDto extends IntersectionType(
  OrderIdDto,
  PartialType(IntersectionType(BaseOrderDto, WorkerDto, OrderDateDto, DimensionDto, StartEndDto, SampleDto))
) {}

/** 更新狀態：0 待處理 / 1 施工中 / 2 已回報 / 3 已完工 */
export class UpdateOrderStatusDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ enum: STATUS_VALUES, example: 2, description: '0 待處理 / 1 施工中 / 2 已回報 / 3 已完工' })
  @Type(() => Number)
  @IsIn(STATUS_VALUES)
  STATUS!: number;

  @ApiPropertyOptional({ example: '邊緣未壓實，退回重做', maxLength: 250, description: '退回原因；驗收不合格時填' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  REJECT_REASON?: string;
}

// ═══ 查詢 ═══════════════════════════════════════════════════════

export class WorkOrderQueryDto {
  @ApiPropertyOptional({ example: 'DEMO01PA2608', maxLength: 30, description: '派工單號，支援前綴比對' })
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

  @ApiPropertyOptional({ example: '2026-08-01', description: '派工日期(起)' })
  @IsOptional()
  @IsDateString()
  START_DATE?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: '派工日期(迄)' })
  @IsOptional()
  @IsDateString()
  END_DATE?: string;

  @ApiPropertyOptional({ example: '2026-09-05', description: '限期完工日(起)' })
  @IsOptional()
  @IsDateString()
  DUE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: '限期完工日(迄)' })
  @IsOptional()
  @IsDateString()
  DUE_TO?: string;

  @ApiPropertyOptional({ example: '臺中市', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', isArray: true, description: '行政區，可多選' })
  @IsOptional()
  @ToArray()
  @IsString({ each: true })
  DISTRICT?: string[];

  @ApiPropertyOptional({ example: 1024, description: '來源案件 id；案件詳情用它反查有沒有派過工' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  CASE_PATROL_ID?: number;

  @ApiPropertyOptional({ example: '臺灣大道', maxLength: 50, description: '關鍵字：比對單號、地址、備註' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  KEYWORD?: string;

  @ApiPropertyOptional({ example: '何厝里', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  CAVLGE?: string;

  @ApiPropertyOptional({ example: '臺灣大道', maxLength: 100, description: '施工地點，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ADDRESS?: string;

  @ApiPropertyOptional({ example: 4, description: '施工人員' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  WORKER_USER_ID?: number;

  @ApiPropertyOptional({ enum: MATERIAL_KEYS, isArray: true, description: '施工材料，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(MATERIAL_KEYS, { each: true })
  MATERIAL?: string[];

  @ApiPropertyOptional({ example: true, description: '只看逾期未完工的' })
  @IsOptional()
  @toBool()
  @IsBoolean()
  OVERDUE?: boolean;

  @ApiPropertyOptional({ example: true, description: '只看缺照片的（依類型檢查必要照片）' })
  @IsOptional()
  @toBool()
  @IsBoolean()
  MISSING_IMAGE?: boolean;

  @ApiPropertyOptional({ example: 'DISPATCH_DATE', enum: ['DISPATCH_DATE', 'DUE_DATE', 'CASE_NUM', 'STATUS'], default: 'DISPATCH_DATE' })
  @IsOptional()
  @IsIn(['DISPATCH_DATE', 'DUE_DATE', 'CASE_NUM', 'STATUS'])
  SORT_BY?: string = 'DISPATCH_DATE';

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

/** 上傳照片：multipart 表單的非檔案欄位 */
export class UploadImageDto {
  @ApiProperty({ example: 3, description: '派工單 id' })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({
    example: '["IMG_BEFORE","IMG_AFTER"]',
    description: '要刪除的既有照片，值為照片類型的 JSON 字串陣列'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  IMAGE_DELETE?: string;
}

export class DeleteImageDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ enum: IMAGE_TYPES, example: 'IMG_BEFORE' })
  @IsIn(IMAGE_TYPES)
  IMG_TYPE!: string;
}
