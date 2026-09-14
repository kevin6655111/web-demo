import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  MaxLength,
  Min
} from 'class-validator';
import { SURVEY_ORDER_STATE } from './entities/survey-order.entity';
import { SURVEY_CASE_STATE, SURVEY_CASE_SOURCE, SURVEY_METHOD } from './entities/survey-case.entity';
import { SURVEY_DIRECTION } from './entities/survey-order-detail.entity';
import { ToArray } from '@/fleet/fleet.dto';
import { ToNumberArray } from '@/case-patrol/case-patrol.dto';
import { CRACK_TYPE_DEF, DEGREE_DEF, WEATHER_DEF, keysOf } from '@road-patrol/shared';

const CRACK_KEYS = CRACK_TYPE_DEF.map((c) => c.key);
const DEGREE_KEYS = DEGREE_DEF.map((d) => d.key);
const WEATHER_KEYS = keysOf(WEATHER_DEF);

export class SurveyOrderQueryDto {
  @ApiPropertyOptional({ example: 'SV-2026', description: '委託單號，部分比對' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ORDER_NO?: string;

  @ApiPropertyOptional({ enum: SURVEY_ORDER_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_ORDER_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  DATE_FROM?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  DATE_TO?: string;
}

export class UpsertSurveyOrderDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: '臺灣大道路面爭議調查' })
  @IsString()
  @MaxLength(100)
  TITLE!: string;

  @ApiPropertyOptional({ example: '示範市政府建設局', description: '委託單位' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  REQUESTER?: string;

  @ApiPropertyOptional({ example: 3, description: '指派的調查人員' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SURVEYOR_ID?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: '2026-09-15' })
  @IsOptional()
  @IsDateString()
  DUE_DATE?: string;

  @ApiPropertyOptional({ enum: SURVEY_ORDER_STATE, example: 'ISSUED' })
  @IsOptional()
  @IsIn(SURVEY_ORDER_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: '含三處鑽心取樣' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  REMARK?: string;
}

export class SurveyCaseQueryDto {
  @ApiPropertyOptional({ example: 1, description: '所屬委託單' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ORDER_ID?: number;

  @ApiPropertyOptional({ enum: SURVEY_CASE_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_CASE_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ enum: SURVEY_METHOD, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_METHOD as unknown as string[], { each: true })
  METHOD?: string[];

  @ApiPropertyOptional({ example: '中山路' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;
}

export class UpsertSurveyCaseDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ORDER_ID!: number;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiProperty({ enum: SURVEY_METHOD, example: 'CORE_DRILL', description: '不同方法可信度不同，報告會標出來' })
  @IsIn(SURVEY_METHOD as unknown as string[])
  METHOD!: string;

  @ApiPropertyOptional({ example: '中山路一段' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;

  @ApiPropertyOptional({ example: 3, description: '對應路段；調查結果會回寫它的 PCI' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SEGMENT_ID?: number;

  @ApiPropertyOptional({ example: 12.5, description: '鋪面厚度(公分)，鑽心取樣才有' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  THICKNESS_CM?: number;

  @ApiPropertyOptional({ example: 65.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI?: number;

  @ApiPropertyOptional({ example: 3.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  IRI?: number;

  @ApiPropertyOptional({ enum: SURVEY_CASE_STATE, example: 'DONE' })
  @IsOptional()
  @IsIn(SURVEY_CASE_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: 'survey/5.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  PHOTO_KEY?: string;

  @ApiPropertyOptional({ example: '面層厚度不足，建議整段刨鋪' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  FINDING?: string;
}


// ═══ 委託明細 ═══════════════════════════════════════════════════

export class UpsertSurveyDetailDto {
  @ApiPropertyOptional({ example: 4, description: '有帶就是更新' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 1, description: '所屬委託單' })
  @Type(() => Number)
  @IsInt()
  ORDER_ID!: number;

  @ApiPropertyOptional({ example: 1, description: '明細序號；省略時接在最後' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SEQ?: number;

  @ApiProperty({ example: '中山路一段' })
  @IsString()
  @MaxLength(100)
  ROAD!: string;

  @ApiPropertyOptional({ example: '文心路口' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ROAD_START?: string;

  @ApiPropertyOptional({ example: '大墩路口' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ROAD_END?: string;

  @ApiPropertyOptional({ example: 3, description: '樁號公里數：3K+250 的 3' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  STATION_K?: number;

  @ApiPropertyOptional({ example: 250, description: '樁號公尺數：3K+250 的 250' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  STATION_M?: number;

  @ApiPropertyOptional({ enum: SURVEY_DIRECTION, example: 'BOTH', default: 'BOTH' })
  @IsOptional()
  @IsIn(SURVEY_DIRECTION as unknown as string[])
  DIRECTION?: string;

  @ApiPropertyOptional({ example: 2, default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  LANE_COUNT?: number;

  @ApiPropertyOptional({ example: 3, description: '應取樣數；與完成的調查點數比對就是進度', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  SAMPLE_COUNT?: number;

  @ApiPropertyOptional({ example: 1250.5, description: '路段長度(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ROAD_LENGTH_M?: number;

  @ApiPropertyOptional({ example: 12.5, description: '路寬(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ROAD_WIDTH_M?: number;

  @ApiPropertyOptional({ example: '含路口十字範圍' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

// ═══ App 現場收案 ═══════════════════════════════════════════════

/**
 * App 上傳的調查點。
 *
 * 與網頁排點的差別在「誰知道什麼」：現場人員知道實際位置、車道、天氣與破壞狀況，
 * 但不知道這個點屬於委託單的第幾項 —— 所以 `DETAIL_ID` 是選填的，
 * 由後端依路名比對，比不到就當成臨時加測。
 */
export class AppSurveyCaseDto {
  @ApiProperty({ example: 'SV-APP-20260901-0001', maxLength: 60, description: '上游識別碼，重送時值必須一致' })
  @IsString()
  @Length(1, 60)
  EXTERNAL_ID!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ORDER_ID!: number;

  @ApiPropertyOptional({ example: 2, description: '對應的委託明細；省略時依路名比對' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  DETAIL_ID?: number;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiProperty({ enum: SURVEY_METHOD, example: 'VISUAL' })
  @IsIn(SURVEY_METHOD as unknown as string[])
  METHOD!: string;

  @ApiPropertyOptional({ example: '中山路一段' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ROAD_NAME?: string;

  @ApiPropertyOptional({ example: '示範市' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;

  @ApiPropertyOptional({ example: 2, description: '第幾車道' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  LANE?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  STATION_K?: number;

  @ApiPropertyOptional({ example: 250 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  STATION_M?: number;

  @ApiPropertyOptional({ enum: WEATHER_KEYS, example: '晴' })
  @IsOptional()
  @IsIn(WEATHER_KEYS)
  WEATHER?: string;

  @ApiPropertyOptional({ enum: CRACK_KEYS, example: 'Alligator_Cracking', description: '現場看到的破壞類型' })
  @IsOptional()
  @IsIn(CRACK_KEYS)
  DTYPE?: string;

  @ApiPropertyOptional({ enum: DEGREE_KEYS, example: 'B' })
  @IsOptional()
  @IsIn(DEGREE_KEYS)
  DEGREE?: string;

  @ApiPropertyOptional({ example: 2.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DTYPE_LENGTH?: number;

  @ApiPropertyOptional({ example: 1.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  DTYPE_WIDTH?: number;

  @ApiPropertyOptional({ example: 3, description: '同一點的破壞數量' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DTYPE_QTY?: number;

  @ApiPropertyOptional({ example: 12.5, description: '鋪面厚度(cm)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  THICKNESS_CM?: number;

  @ApiPropertyOptional({ example: 65.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI?: number;

  @ApiPropertyOptional({ example: 3.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  IRI?: number;

  @ApiPropertyOptional({ example: 'survey/app/0001.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  PHOTO_KEY?: string;

  @ApiPropertyOptional({ example: '面層厚度偏低' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  FINDING?: string;
}

// ═══ 批次狀態與轉讓 ═════════════════════════════════════════════

export class SurveyCaseStatusDto {
  @ApiProperty({ example: [5, 6], type: [Number] })
  @ToNumberArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiProperty({
    enum: [...SURVEY_CASE_STATE, 'DELETED'],
    example: 'DONE',
    description: 'DELETED 是軟刪除：資料留著，只是不再出現在清單'
  })
  @IsIn([...SURVEY_CASE_STATE, 'DELETED'])
  STATE!: string;

  @ApiPropertyOptional({ example: '路段重複取樣' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REASON?: string;
}

/**
 * 轉讓案件。
 *
 * 現場常發生「這個點其實屬於另一張委託單」——
 * 刪掉重建會失去現場照片與量測值，所以是搬移而不是重來。
 */
export class TransferSurveyCaseDto {
  @ApiProperty({ example: [5, 6], type: [Number] })
  @ToNumberArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  IDS!: number[];

  @ApiProperty({ example: 2, description: '目標委託單' })
  @Type(() => Number)
  @IsInt()
  TO_ORDER_ID!: number;

  @ApiPropertyOptional({ example: 7, description: '目標明細；省略時不掛明細' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  TO_DETAIL_ID?: number;

  @ApiProperty({ example: '原委託單範圍誤植', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  REASON!: string;
}

/** 專家系統的清單：欄位比一般清單多，而且看得到已刪除的 */
export class ExpertSurveyQueryDto extends SurveyCaseQueryDto {
  @ApiPropertyOptional({ example: true, description: '包含已刪除的案件' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  INCLUDE_DELETED?: boolean;

  @ApiPropertyOptional({ enum: SURVEY_CASE_SOURCE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SURVEY_CASE_SOURCE as unknown as string[], { each: true })
  SOURCE?: string[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  DETAIL_ID?: number;
}
