import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested
} from 'class-validator';
import { HOME_SYS_DEF, keysOf } from '@road-patrol/shared';
import { ACTION_KEYS } from '@constants/module.const';

const HOME_SYS_KEYS = keysOf(HOME_SYS_DEF);

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

/** 人員資料欄位：新增與更新共用 */
class UserProfileDto {
  @ApiPropertyOptional({ example: 1, description: '部門' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  DEPARTMENT_ID?: number;

  @ApiPropertyOptional({ example: 2, description: '主管；請假代理與催辦要找得到人' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  MANAGER_ID?: number;

  @ApiPropertyOptional({ example: 'Ming Wang', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ENGLISH_NAME?: string;

  @ApiPropertyOptional({ example: 'ming@example.com', maxLength: 120 })
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  EMAIL?: string;

  @ApiPropertyOptional({ example: '巡查員', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  JOB_TITLE?: string;

  @ApiPropertyOptional({ example: '2026-01-15', description: '入職日' })
  @IsOptional()
  @IsDateString()
  HIRE_DATE?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: '離職日；到了這天帳號自動失效' })
  @IsOptional()
  @IsDateString()
  LEAVE_DATE?: string;

  @ApiPropertyOptional({ enum: HOME_SYS_KEYS, example: 'DASHBOARD', description: '登入後預設進入的模組' })
  @IsOptional()
  @IsIn(HOME_SYS_KEYS)
  HOME_SYS?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00+08:00', description: '帳號到期時間；臨時或外包帳號用' })
  @IsOptional()
  @IsDateString()
  EXPIRE_AT?: string;
}

export class CreateAccountDto extends UserProfileDto {
  @ApiProperty({ example: 'inspector02' })
  @IsString()
  @Length(1, 30)
  ACCOUNT!: string;

  @ApiProperty({ example: '王小明' })
  @IsString()
  @MaxLength(30)
  USER_NAME!: string;

  @ApiPropertyOptional({
    example: 'demo1234',
    description: '初始密碼；省略時系統產生一組隨機密碼並在回應中回傳一次。無論哪一種，首次登入都必須更改'
  })
  @IsOptional()
  @IsString()
  @Length(8, 72)
  PASSWORD?: string;

  @ApiProperty({ example: 'INSPECTOR', description: '角色代號' })
  @IsString()
  @Length(1, 20)
  ROLE_KEY!: string;
}

/** 更新帳號：只送要改的欄位 */
export class UpdateAccountDto extends UserProfileDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({ example: '王小明' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  USER_NAME?: string;

  @ApiPropertyOptional({ example: 'INSPECTOR' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  ROLE_KEY?: string;
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
  @ApiPropertyOptional({ required: false, example: '王' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  KEYWORD?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  DEPARTMENT_ID?: number;

  @ApiPropertyOptional({ example: 'INSPECTOR' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ROLE_KEY?: string;

  @ApiPropertyOptional({ example: true, description: '只看啟用中' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ACTIVE?: boolean;
}

/** 使用者自己改密碼 */
export class ChangePasswordDto {
  @ApiProperty({ example: 'Demo1234' })
  @IsString()
  @Length(8, 72)
  OLD_PASSWORD!: string;

  @ApiProperty({ example: 'Patrol2026!' })
  @IsString()
  @Length(8, 72)
  NEW_PASSWORD!: string;
}

/** 管理者重設別人的密碼 */
export class ResetPasswordDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  ID!: number;

  @ApiPropertyOptional({ example: 'Temp2026!', description: '省略時系統產生隨機密碼並回傳一次' })
  @IsOptional()
  @IsString()
  @Length(8, 72)
  PASSWORD?: string;
}

// ─── 個人授權覆蓋 ────────────────────────────────────────────────

export class ActionOverrideItemDto {
  @ApiProperty({ example: 'WORK_ORDER.ACCEPT', enum: ACTION_KEYS })
  @IsIn(ACTION_KEYS as string[])
  ACTION_KEY!: string;

  @ApiProperty({ example: true, description: 'true 額外開啟；false 明確撤銷' })
  @IsBoolean()
  IS_GRANTED!: boolean;

  @ApiProperty({ example: '代理主管期間', maxLength: 200, description: '為什麼這個人跟同角色的人不一樣' })
  @IsString()
  @Length(1, 200)
  REASON!: string;
}

export class SetActionOverridesDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  USER_ID!: number;

  @ApiProperty({ type: [ActionOverrideItemDto], description: '完整清單；沒列到的既有覆蓋會被移除' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ActionOverrideItemDto)
  OVERRIDES!: ActionOverrideItemDto[];
}

// ─── 部門 ────────────────────────────────────────────────────────

export class UpsertDepartmentDto {
  @ApiPropertyOptional({ example: 2, description: '有帶就是更新' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ID?: number;

  @ApiProperty({ example: 'S1' })
  @IsString()
  @Length(1, 20)
  KEY!: string;

  @ApiProperty({ example: '第一工務段' })
  @IsString()
  @Length(1, 50)
  NAME!: string;

  @ApiPropertyOptional({ example: 1, description: '上層部門' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PARENT_ID?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  IS_ACTIVE?: boolean;
}

// ─── API Key ─────────────────────────────────────────────────────

export class CreateApiKeyDto {
  @ApiProperty({ example: '巡查一號車車機', maxLength: 60 })
  @IsString()
  @Length(1, 60)
  NAME!: string;

  @ApiProperty({
    example: ['CASE.CREATE', 'TRACK.CREATE'],
    enum: ACTION_KEYS,
    isArray: true,
    description: '這把金鑰能做的事；只能核發自己有的權限'
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsIn(ACTION_KEYS as string[], { each: true })
  SCOPES!: string[];

  @ApiPropertyOptional({ example: '2027-12-31T23:59:59+08:00', description: '到期時間；省略為永久' })
  @IsOptional()
  @IsDateString()
  EXPIRES_AT?: string;
}
