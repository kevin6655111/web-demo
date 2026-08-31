import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { MAINTAIN_LEVEL } from './entities/road-segment.entity';
import { ToArray } from '@/fleet/fleet.dto';

export class SegmentQueryDto {
  @ApiPropertyOptional({ example: '中山路', description: '路名，模糊比對' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ROAD_NAME?: string;

  @ApiPropertyOptional({ example: '西屯區' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  DISTRICT?: string;

  @ApiPropertyOptional({ enum: MAINTAIN_LEVEL, isArray: true, description: '養護等級，可多選' })
  @IsOptional()
  @ToArray()
  @IsIn(MAINTAIN_LEVEL as unknown as string[], { each: true })
  MAINTAIN_LEVEL?: string[];

  @ApiPropertyOptional({ example: 0, description: 'PCI 下限' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI_MIN?: number;

  @ApiPropertyOptional({ example: 60, description: 'PCI 上限；查「該修的路」就設 60' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI_MAX?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;
}

export class UpdateSegmentDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({ example: 72.5, description: '人工調整後的 PCI' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  PCI?: number;

  @ApiPropertyOptional({ example: 3.2, description: '國際糙度指數 m/km' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  IRI?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  LANE_COUNT?: number;

  @ApiPropertyOptional({ example: '已排入 116 年度刨鋪' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  REMARK?: string;
}

export class SegmentEvalDto {
  @ApiPropertyOptional({ example: 1, description: '只重算指定標案的路段；不帶就全部' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PROJECT_ID?: number;
}
