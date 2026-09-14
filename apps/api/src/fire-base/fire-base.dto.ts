import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEVICE_PLATFORM } from './entities/device-token.entity';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'fcm-token-abc123', maxLength: 255, description: '推播服務發給該裝置的權杖' })
  @IsString()
  @MaxLength(255)
  TOKEN!: string;

  @ApiProperty({ enum: DEVICE_PLATFORM, example: 'ANDROID' })
  @IsIn(DEVICE_PLATFORM as unknown as string[])
  PLATFORM!: string;

  @ApiPropertyOptional({ example: 'Pixel 8（工地機）', maxLength: 100, description: '讓使用者辨認要停用哪一台' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  DEVICE_NAME?: string;
}

export class UnregisterDeviceDto {
  @ApiProperty({ example: 'fcm-token-abc123', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  TOKEN!: string;
}
