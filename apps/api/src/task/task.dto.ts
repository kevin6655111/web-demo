import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { TASK_DEFS } from './task-definitions';

const TASK_KEYS = Object.keys(TASK_DEFS);

export class TriggerTaskDto {
  @ApiProperty({ enum: TASK_KEYS, example: 'addressGeocoder', description: '排程名稱' })
  @IsIn(TASK_KEYS)
  KEY!: string;
}
