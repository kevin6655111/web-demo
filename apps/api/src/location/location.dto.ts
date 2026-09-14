import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsString, Max, MaxLength, Min, IsOptional } from 'class-validator';

export class ReverseGeocodeDto {
  @ApiProperty({ example: 120.6478, description: '經度' })
  @Type(() => Number)
  @IsLongitude()
  LNG!: number;

  @ApiProperty({ example: 24.1789, description: '緯度' })
  @Type(() => Number)
  @IsLatitude()
  LAT!: number;
}

export class AutoCompleteDto {
  @ApiProperty({ example: '中山', maxLength: 50, description: '關鍵字，至少兩個字' })
  @IsString()
  @MaxLength(50)
  KEYWORD!: string;

  @ApiPropertyOptional({ example: 10, default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  LIMIT?: number = 10;
}

export class ForwardGeocodeDto {
  @ApiProperty({ example: '示範市西屯區中山路一段99號', maxLength: 120, description: '完整地址' })
  @IsString()
  @MaxLength(120)
  ADDRESS!: string;
}
