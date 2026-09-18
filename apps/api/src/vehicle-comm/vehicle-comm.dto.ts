import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { COMMAND_ACTIONS } from './vehicle-comm.type';

export class DeviceCommandDto {
  @ApiProperty({ example: 'DEV-0001', description: '車機識別碼' })
  @IsString()
  @Length(1, 40)
  DEVICE_ID!: string;

  @ApiProperty({
    enum: COMMAND_ACTIONS,
    example: 'STREAM_START',
    description: '串流開始／停止、查詢 ECU、拍一張、重開機'
  })
  @IsIn(COMMAND_ACTIONS as unknown as string[])
  ACTION!: string;

  @ApiPropertyOptional({ example: { quality: 'high' }, description: '指令參數；依指令而異' })
  @IsOptional()
  @IsObject()
  PAYLOAD?: Record<string, unknown>;
}

/**
 * 模擬器。
 *
 * Demo 沒有真的車機，但「車機通訊」這個功能沒有東西可看就等於不存在。
 * 這支端點讓伺服器自己扮演車機連上來，跑一段可預期的狀態變化。
 */
export class SimulateDeviceDto {
  @ApiProperty({ example: 'DEV-0001' })
  @IsString()
  @Length(1, 40)
  DEVICE_ID!: string;

  @ApiPropertyOptional({ example: 60, default: 60, description: '模擬持續秒數' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  DURATION_SEC?: number;

  @ApiPropertyOptional({ example: true, default: false, description: '是否模擬影像串流' })
  @IsOptional()
  STREAM?: boolean;

  @ApiPropertyOptional({ example: 'P0301', maxLength: 20, description: '模擬一個故障碼' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  FAULT_CODE?: string;
}
