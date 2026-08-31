import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PATROL_FREQUENCY } from './entities/patrol-plan.entity';

export class PlanQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ enum: PATROL_FREQUENCY })
  @IsOptional()
  @IsIn(PATROL_FREQUENCY as unknown as string[])
  FREQUENCY?: string;

  @ApiPropertyOptional({ example: true, description: '只看啟用中的計畫' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ACTIVE?: boolean;
}

export class UpsertPlanDto {
  @ApiPropertyOptional({ example: 2, description: '有帶就是更新' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 'PLAN-A-001' })
  @IsString()
  @Length(1, 40)
  CODE!: string;

  @ApiProperty({ example: '市區主幹道週巡' })
  @IsString()
  @MaxLength(60)
  NAME!: string;

  @ApiProperty({ enum: PATROL_FREQUENCY, example: 'WEEKLY' })
  @IsIn(PATROL_FREQUENCY as unknown as string[])
  FREQUENCY!: string;

  @ApiProperty({
    example: [
      [120.64, 24.16],
      [120.66, 24.17]
    ],
    description: '路線座標序列 [[lng, lat], …]，至少兩點'
  })
  @IsArray()
  @ArrayMinSize(2)
  ROUTE!: [number, number][];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  VEHICLE_ID?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;

  @ApiPropertyOptional({ example: 30, description: '覆蓋率判定的緩衝距離(公尺)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(200)
  BUFFER_M?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ACTIVE?: boolean;

  @ApiPropertyOptional({ example: '含臺灣大道全線' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

export class CoverageQueryDto {
  @ApiProperty({ example: '2026-08-23' })
  @IsDateString()
  DATE_START!: string;

  @ApiProperty({ example: '2026-08-29' })
  @IsDateString()
  DATE_END!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;
}
