import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  Min
} from 'class-validator';
import { VEHICLE_STATE, VEHICLE_TYPE } from './entities/vehicle.entity';

/** 逗號字串或陣列都接受：查詢字串沒有陣列型別，前端送什麼形狀都要能用 */
export const ToArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
  });

// ─── 車隊 ────────────────────────────────────────────────────────

export class VehicleQueryDto {
  @ApiPropertyOptional({ example: 'ABC-1234', description: '車牌，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  PLATE_NO?: string;

  @ApiPropertyOptional({ enum: VEHICLE_TYPE, isArray: true, description: '用途，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(VEHICLE_TYPE as unknown as string[], { each: true })
  VEHICLE_TYPE?: string[];

  @ApiPropertyOptional({ enum: VEHICLE_STATE, isArray: true, description: '狀態，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(VEHICLE_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ example: 1, description: '所屬標案' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: true, description: '只看目前在線的車' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ONLINE_ONLY?: boolean;

  @ApiPropertyOptional({ example: 'DEMO01', description: '標案號；透過 project_vehicles 關聯比對' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  PRJ_ID?: string;

  @ApiPropertyOptional({ example: 1, description: '工務段；經由標案的工務段關聯比對' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SECTION_ID?: number;

  @ApiPropertyOptional({ example: '示範市', maxLength: 10, description: '縣市；經由工務段轄區比對' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  COUNTY?: string;

  @ApiPropertyOptional({ example: '西屯區', maxLength: 10, description: '行政區；經由工務段轄區比對' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  DISTRICT?: string;
}

export class UpsertVehicleDto {
  @ApiPropertyOptional({ example: 3, description: '有帶就是更新，沒帶就是新增' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 'ABC-1234' })
  @IsString()
  @Length(1, 15)
  PLATE_NO!: string;

  @ApiPropertyOptional({ example: '巡查一號車' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  NAME?: string;

  @ApiProperty({ enum: VEHICLE_TYPE, example: 'PATROL' })
  @IsIn(VEHICLE_TYPE as unknown as string[])
  VEHICLE_TYPE!: string;

  @ApiPropertyOptional({ example: 'DEV-0001', description: '車機識別碼；換車牌時這個不變' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  DEVICE_ID?: string;

  @ApiPropertyOptional({ example: 3, description: '駕駛' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  DRIVER_ID?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ enum: VEHICLE_STATE, example: 'OFFLINE' })
  @IsOptional()
  @IsIn(VEHICLE_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: '例行保養中' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

// ─── 軌跡 ────────────────────────────────────────────────────────

export class AddTrackDto {
  @ApiProperty({ example: 'DEV-0001', description: '車機識別碼' })
  @IsString()
  @MaxLength(40)
  DEVICE_ID!: string;

  @ApiProperty({ example: 120.6478 })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1636 })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;

  @ApiProperty({ example: '2026-08-29T09:12:00+08:00' })
  @IsDateString()
  RECORDED_AT!: string;

  @ApiPropertyOptional({ example: 32.5, description: '時速' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(250)
  SPEED_KPH?: number;

  @ApiPropertyOptional({ example: 180, description: '方位角 0–359' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  HEADING?: number;

  @ApiPropertyOptional({ example: 0.8, description: 'GPS HDOP；大於 5 的點畫出來會亂跳' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  GPS_HDOP?: number;

  @ApiPropertyOptional({ example: 45.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ALTITUDE?: number;

  @ApiPropertyOptional({ example: false, description: '是否為一趟行程的起點' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  IS_TRIP_START?: boolean;
}

export class TrackQueryDto {
  @ApiProperty({ example: 1, description: '車輛編號' })
  @Type(() => Number)
  @IsInt()
  VEHICLE_ID!: number;

  @ApiProperty({ example: '2026-08-29T00:00:00+08:00' })
  @IsDateString()
  DATE_START!: string;

  @ApiProperty({ example: '2026-08-29T23:59:59+08:00' })
  @IsDateString()
  DATE_END!: string;

  @ApiPropertyOptional({ example: 5, description: 'GPS HDOP 上限，超過的點會被濾掉', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  MAX_HDOP?: number = 5;

  @ApiPropertyOptional({ example: 3000, description: '回傳點數上限；超過會等距抽樣', default: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(20000)
  MAX_POINTS?: number = 3000;
}

export class TrackStatsQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  VEHICLE_ID?: number;

  @ApiProperty({ example: '2026-08-22' })
  @IsDateString()
  DATE_START!: string;

  @ApiProperty({ example: '2026-08-29' })
  @IsDateString()
  DATE_END!: string;
}
