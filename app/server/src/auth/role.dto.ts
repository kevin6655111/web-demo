import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsString, Length, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'SUPERVISOR' })
  @IsString()
  @Length(1, 20)
  KEY!: string;

  @ApiProperty({ example: '工地主任' })
  @IsString()
  @MaxLength(50)
  NAME!: string;

  @ApiProperty({ example: ['CASE.READ', 'WORK_ORDER.ACCEPT'], type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  ACTIONS!: string[];
}

export class UpdateRoleActionsDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiProperty({ example: ['CASE.READ', 'CASE.CREATE'], type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  ACTIONS!: string[];
}
