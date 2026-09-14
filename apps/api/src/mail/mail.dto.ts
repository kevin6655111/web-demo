import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAIL_STATE } from './entities/mail-job.entity';

export class MailQueryDto {
  @ApiPropertyOptional({ enum: MAIL_STATE, description: '狀態篩選；不給就全部' })
  @IsOptional()
  @IsIn(MAIL_STATE as unknown as string[])
  STATE?: string;

  @ApiPropertyOptional({ example: 100, default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  LIMIT?: number = 100;
}

export class SendTestMailDto {
  @ApiProperty({ example: 'demo@example.com', description: '收件地址' })
  @IsEmail()
  @MaxLength(200)
  TO!: string;

  @ApiPropertyOptional({ example: 'admin', description: '信中顯示的帳號名稱' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ACCOUNT?: string;
}
