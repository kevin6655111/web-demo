import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ANNOUNCEMENT_LEVEL } from './announcement.entity';

export class UpsertAnnouncementDto {
  @ApiPropertyOptional({ example: 2, description: '有帶就是更新' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: '9/5 系統維護公告' })
  @IsString()
  @Length(1, 100)
  TITLE!: string;

  @ApiProperty({ example: '9/5 22:00–24:00 進行資料庫維護，期間車機上傳會暫存於本機，恢復後自動補送。' })
  @IsString()
  @Length(1, 1000)
  BODY!: string;

  @ApiPropertyOptional({ enum: ANNOUNCEMENT_LEVEL, example: 'WARNING' })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_LEVEL as unknown as string[])
  LEVEL?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00+08:00', description: '不帶則立即生效' })
  @IsOptional()
  @IsDateString()
  START_AT?: string;

  @ApiPropertyOptional({ example: '2026-09-06T00:00:00+08:00', description: '不帶則永久顯示' })
  @IsOptional()
  @IsDateString()
  END_AT?: string;

  @ApiPropertyOptional({ example: true, description: '置頂且不可關閉' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  PINNED?: boolean;
}
