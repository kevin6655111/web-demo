import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { SUPPORT_CATEGORY, SUPPORT_STATE } from './entities/support-thread.entity';
import { ToArray } from '@/fleet/fleet.dto';

export class OpenThreadDto {
  @ApiProperty({ example: '車機無法上傳案件', description: '問題摘要' })
  @IsString()
  @Length(1, 100)
  SUBJECT!: string;

  @ApiProperty({ enum: SUPPORT_CATEGORY, example: 'DEVICE' })
  @IsIn(SUPPORT_CATEGORY as unknown as string[])
  CATEGORY!: string;

  @ApiProperty({ example: 'DEMO-001 今天早上開始一直顯示上傳失敗', description: '第一則訊息' })
  @IsString()
  @Length(1, 1000)
  BODY!: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  THREAD_ID!: number;

  @ApiProperty({ example: '收到，我先查一下車機的連線紀錄' })
  @IsString()
  @Length(1, 1000)
  BODY!: string;
}

export class ThreadQueryDto {
  @ApiPropertyOptional({ enum: SUPPORT_STATE, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SUPPORT_STATE as unknown as string[], { each: true })
  STATE?: string[];

  @ApiPropertyOptional({ enum: SUPPORT_CATEGORY, isArray: true })
  @IsOptional()
  @ToArray()
  @IsIn(SUPPORT_CATEGORY as unknown as string[], { each: true })
  CATEGORY?: string[];

  @ApiPropertyOptional({ example: true, description: '只看指派給自己的' })
  @IsOptional()
  @Type(() => Boolean)
  MINE?: boolean;
}

export class UpdateThreadDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({ enum: SUPPORT_STATE, example: 'RESOLVED' })
  @IsOptional()
  @IsIn(SUPPORT_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: true, description: '把這條對話接手過來' })
  @IsOptional()
  @Type(() => Boolean)
  TAKE?: boolean;
}
