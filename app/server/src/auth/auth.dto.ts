import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UserAuthenticateDto {
  @ApiProperty({ example: 'DEMO', description: '公司代號' })
  @IsString()
  @Length(1, 10)
  COMPANY_KEY!: string;

  @ApiProperty({ example: 'admin' })
  @IsString()
  @Length(1, 30)
  ACCOUNT!: string;

  @ApiProperty({ example: 'demo1234' })
  @IsString()
  @Length(8, 72)
  PASSWORD!: string;
}

export class CreateAccountDto {
  @ApiProperty({ example: 'inspector02' })
  @IsString()
  @Length(1, 30)
  ACCOUNT!: string;

  @ApiProperty({ example: '王小明' })
  @IsString()
  @MaxLength(30)
  USER_NAME!: string;

  @ApiProperty({ example: 'demo1234' })
  @IsString()
  @Length(8, 72)
  PASSWORD!: string;

  @ApiProperty({ example: 'INSPECTOR', enum: ['ADMIN', 'INSPECTOR', 'VIEWER'] })
  @IsIn(['ADMIN', 'INSPECTOR', 'VIEWER'])
  ROLE_KEY!: string;
}

export class SetAccountActiveDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  ID!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  ACTIVE!: boolean;
}

export class OrgUserQueryDto {
  @ApiProperty({ required: false, example: '王' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  KEYWORD?: string;
}
