import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { AuthService } from './auth.service';
import { ApiKeyService } from './api-key.service';
import {
  ChangePasswordDto,
  CreateAccountDto,
  CreateApiKeyDto,
  OrgUserQueryDto,
  ResetPasswordDto,
  SetAccountActiveDto,
  SetActionOverridesDto,
  UpdateAccountDto,
  UpsertDepartmentDto,
  UserAuthenticateDto
} from './auth.dto';

@ApiTags('Auth')
@ApiBearerAuth(API_AUTH)
@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService
  ) {}

  // ═══ 登入與憑證 ═══════════════════════════════════════════════

  /** 使用者登入驗證 */
  @Post('user/authenticate')
  @ApiOperation({
    summary: '登入',
    description: [
      '驗證成功後同時回傳 token 與寫入 httpOnly cookie ——',
      '瀏覽器用 cookie(XSS 偷不走)，App 與對接系統用回應主體的 token。',
      '',
      '**防爆破**：同一帳號連續失敗 5 次會鎖定 15 分鐘；',
      '帳號不存在與密碼錯誤回傳相同訊息，且花費相近的時間，避免被用來枚舉帳號。',
      '',
      '回應的 `data.mustChangePassword` 為 true 時(首次登入、被重設、密碼到期)，',
      '前端應先帶使用者改密碼再進入系統。',
      '',
      '此端點另有較嚴格的流量限制(每分鐘 10 次)。',
      '',
      '不需權限。'
    ].join('\n')
  })
  @ApiBody({
    type: UserAuthenticateDto,
    examples: {
      admin: { summary: '管理員', value: { COMPANY_KEY: 'DEMO', ACCOUNT: 'admin', PASSWORD: 'Demo1234' } },
      worker: { summary: '施工人員', value: { COMPANY_KEY: 'DEMO', ACCOUNT: 'worker1', PASSWORD: 'Demo1234' } }
    }
  })
  @ApiResponse({ status: 201, description: '登入成功。`data` 含 token、有效秒數、使用者權限與是否須改密碼' })
  @ApiResponse({ status: 401, description: '帳號或密碼錯誤、帳號已停用/到期/離職，或已被暫時鎖定' })
  @ApiResponse({ status: 429, description: '嘗試過於頻繁' })
  // 登入是攻擊面最大的端點：全域限制擋不住針對單一帳號的慢速嘗試，這裡再收緊一層
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'AUTH', keys: ['COMPANY_KEY', 'ACCOUNT'] })
  async handleUserAuthenticate(
    @Body() dto: UserAuthenticateDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<HttpResult> {
    return await this.authService.userAuthenticate(dto, res);
  }

  /** 取得使用者資訊 */
  @Get('auth/user/prefs')
  @ApiOperation({
    summary: '取得登入者資訊',
    description: [
      '回傳 token 內的身分與權限，加上部門、職稱、是否須改密碼等個人資料。',
      '前端重新整理後靠這支回填登入狀態 —— token 在 httpOnly cookie 裡，JS 讀不到。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  async handleGetPrefs(@User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.getUserPrefs(user);
  }

  /** 續期 Token */
  @Put('auth/refresh-token')
  @ApiOperation({
    summary: '續期 Token',
    description: [
      '在有效期內換一張新的 token，讓連續操作的人不會突然被踢出去。',
      '',
      '**過期後不能續期** —— 否則等於沒有有效期限。關掉瀏覽器隔天回來仍要重新登入。',
      '',
      '換發時重新讀一次角色權限與個人覆蓋：剛調整過的權限會在這一刻生效，不必登出再登入。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '已續期，回傳新的 token' })
  @ApiCommonErrors()
  async handleRefreshToken(@User() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<HttpResult> {
    return await this.authService.refreshToken(user, res);
  }

  /** 臨時 Token */
  @Post('auth/temp-token')
  @ApiOperation({
    summary: '核發臨時唯讀 Token',
    description: [
      '給外部系統嵌入用(例如市府入口網要開一個統計頁)。',
      '',
      '**只帶唯讀權限、效期 5 分鐘、不寫入 cookie** ——',
      '它是要放進網址或表頭給第三方用的，不該綁在瀏覽器上。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiResponse({ status: 201, description: '已核發' })
  @ApiCommonErrors()
  @Audit({ action: 'AUTH', keys: [] })
  handleCreateTempToken(@User() user: AuthUser): HttpResult {
    return this.authService.createTempToken(user);
  }

  /** 登出 */
  @Post('auth/logout')
  @ApiOperation({
    summary: '登出',
    description: ['清除 cookie。App 端請自行丟棄 token。', '', '不需額外權限(需已登入)。'].join('\n')
  })
  @ApiResponse({ status: 201, description: '已登出' })
  @ApiCommonErrors()
  @Audit({ action: 'AUTH', keys: [] })
  handleLogout(@Res({ passthrough: true }) res: Response): HttpResult {
    return this.authService.logout(res);
  }

  // ═══ 密碼 ═════════════════════════════════════════════════════

  /** 更改自己的密碼 */
  @Put('auth/account/password')
  @ApiOperation({
    summary: '更改密碼',
    description: [
      '使用者改自己的密碼。',
      '',
      '政策：**24 小時內只能改一次**、**不可與最近 3 次相同**、至少 8 碼且混合兩種字元類型、不可包含帳號。',
      '首次登入(被標記須改密碼)不受冷卻限制。',
      '',
      '刻意不強制符號 —— 那會把人逼去寫便利貼，實務上更不安全(NIST SP 800-63B)。',
      '',
      '不需額外權限(需已登入)。'
    ].join('\n')
  })
  @ApiBody({
    type: ChangePasswordDto,
    examples: { sample: { summary: '改密碼', value: { OLD_PASSWORD: 'Demo1234', NEW_PASSWORD: 'Patrol2026!' } } }
  })
  @ApiResponse({ status: 200, description: '密碼已更新' })
  @ApiCommonErrors({ badRequest: '不符政策：冷卻期內、與近期相同、或強度不足' })
  @Audit({ action: 'AUTH', keys: [] })
  async handleChangePassword(@Body() dto: ChangePasswordDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.changePassword(dto, user);
  }

  /** 管理者重設密碼 */
  @Put('auth/account/password/reset')
  @ApiOperation({
    summary: '重設他人密碼',
    description: [
      '管理者替鎖在外面的人重設密碼。省略 `PASSWORD` 時系統產生隨機密碼並**只在這次回應中回傳**。',
      '',
      '無論哪一種，該帳號下次登入都必須更改 —— 管理者不該知道別人長期使用的密碼。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({ type: ResetPasswordDto, examples: { random: { summary: '產生隨機密碼', value: { ID: 3 } } } })
  @ApiResponse({ status: 200, description: '已重設；`data.TEMP_PASSWORD` 只出現這一次' })
  @ApiCommonErrors({ notFound: '找不到該帳號' })
  @Audit({ action: 'AUTH', keys: ['ID'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleResetPassword(@Body() dto: ResetPasswordDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.resetPassword(dto, user);
  }

  // ═══ 人員 ═════════════════════════════════════════════════════

  /** 查詢所屬公司的人員 */
  @Get('auth/org/user')
  @ApiOperation({
    summary: '查詢公司人員',
    description: [
      '只回傳登入者所屬公司的帳號，含部門、主管、員工編號、任職期間與個人授權覆蓋數。',
      '`KEYWORD` 對姓名、帳號、員工編號、Email 做模糊比對。',
      '',
      '所需權限：`ACCOUNT.READ`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleGetOrgUser(@Query() dto: OrgUserQueryDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.getOrgUser(dto, user.companyId);
  }

  /** 使用者帳號: 新增 */
  @Post('auth/account')
  @ApiOperation({
    summary: '新增帳號',
    description: [
      '在登入者所屬的公司下建立帳號。員工編號由系統產生(公司代號 + 年 + 四碼流水)。',
      '',
      '省略 `PASSWORD` 時系統產生隨機密碼並只回傳一次；無論哪一種，**首次登入都必須更改密碼**。',
      '受公司人員額度限制。',
      '',
      '所需權限：`ACCOUNT.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateAccountDto,
    examples: {
      inspector: {
        summary: '新增巡查員',
        value: {
          ACCOUNT: 'inspector02',
          USER_NAME: '王小明',
          ROLE_KEY: 'INSPECTOR',
          DEPARTMENT_ID: 1,
          JOB_TITLE: '巡查員',
          EMAIL: 'ming@example.com',
          HIRE_DATE: '2026-01-15',
          HOME_SYS: 'MAP_MOD'
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: '帳號已建立；`data.TEMP_PASSWORD` 只在沒給密碼時出現一次' })
  @ApiCommonErrors({
    badRequest: '參數錯誤: 欄位缺漏，或密碼不符強度規則',
    notFound: '找不到指定角色、部門或主管',
    conflict: '帳號已存在，或已達人員額度上限'
  })
  @Audit({ action: 'AUTH', keys: ['ACCOUNT', 'USER_NAME', 'ROLE_KEY'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.CREATE)
  async handleCreateAccount(@Body() dto: CreateAccountDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.createAccount(dto, user);
  }

  /** 使用者帳號: 更新資料 */
  @Patch('auth/account')
  @ApiOperation({
    summary: '更新帳號資料',
    description: [
      '更新姓名、角色、部門、主管、職稱、任職期間、系統首頁等。只送要改的欄位。',
      '密碼與啟用狀態各有自己的端點。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: UpdateAccountDto,
    examples: { dept: { summary: '調部門', value: { ID: 3, DEPARTMENT_ID: 2, JOB_TITLE: '班長' } } }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ notFound: '找不到帳號、角色、部門或主管' })
  @Audit({ action: 'AUTH', keys: ['ID', 'ROLE_KEY', 'DEPARTMENT_ID'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleUpdateAccount(@Body() dto: UpdateAccountDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.updateAccount(dto, user.companyId);
  }

  /** 使用者帳號: 啟用/停用 */
  @Put('auth/account')
  @ApiOperation({
    summary: '啟用或停用帳號',
    description: [
      '停用後該帳號無法登入，但既有的 token 要等過期才失效(預設 30 分鐘)。',
      '需要立即斷線的情境，請一併在前台強制登出。',
      '',
      '所需權限：`ACCOUNT.DELETE`'
    ].join('\n')
  })
  @ApiBody({
    type: SetAccountActiveDto,
    examples: {
      disable: { summary: '停用', value: { ID: 2, ACTIVE: false } },
      enable: { summary: '啟用', value: { ID: 2, ACTIVE: true } }
    }
  })
  @ApiResponse({ status: 200, description: '狀態已更新' })
  @ApiCommonErrors({ notFound: '找不到該帳號' })
  @Audit({ action: 'AUTH', keys: ['ID', 'ACTIVE'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.DELETE)
  async handleSetAccountActive(@Body() dto: SetAccountActiveDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.setAccountActive(dto, user.companyId);
  }

  // ═══ 個人授權覆蓋 ═════════════════════════════════════════════

  @Get('auth/user/:ID/override')
  @ApiOperation({
    summary: '查詢個人授權覆蓋',
    description: [
      '角色是「這一類人平常能做什麼」，覆蓋是「這一個人例外」：額外開啟或明確撤銷某個功能。',
      '',
      '所需權限：`ACCOUNT.READ`'
    ].join('\n')
  })
  @ApiParam({ name: 'ID', example: 3 })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors({ notFound: '找不到該帳號' })
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleGetOverrides(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.getActionOverrides(id, user.companyId);
  }

  @Put('auth/user/override')
  @ApiOperation({
    summary: '設定個人授權覆蓋',
    description: [
      '整份取代：沒列到的既有覆蓋會被移除。',
      '額外開啟的權限仍受公司開通清單限制，且只能開自己有的；`REASON` 必填 —— 稽核時要知道為什麼這個人例外。',
      '',
      '生效時機：該使用者下次續期或重新登入。',
      '',
      '所需權限：`ACCOUNT.UPDATE`'
    ].join('\n')
  })
  @ApiBody({
    type: SetActionOverridesDto,
    examples: {
      proxy: {
        summary: '代理主管期間開驗收、收回派工',
        value: {
          USER_ID: 3,
          OVERRIDES: [
            { ACTION_KEY: 'WORK_ORDER.ACCEPT', IS_GRANTED: true, REASON: '代理主管 9/1–9/30' },
            { ACTION_KEY: 'WORK_ORDER.CREATE', IS_GRANTED: false, REASON: '調查中暫停派工' }
          ]
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: '已更新' })
  @ApiCommonErrors({ badRequest: '試圖開啟自己沒有的權限', notFound: '找不到該帳號' })
  @Audit({ action: 'AUTH', keys: ['USER_ID'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleSetOverrides(@Body() dto: SetActionOverridesDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.setActionOverrides(dto, user);
  }

  // ═══ 部門 ═════════════════════════════════════════════════════

  @Get('auth/department')
  @ApiOperation({
    summary: '查詢部門',
    description: ['登入者所屬公司的部門清單，含人數。', '', '所需權限：`ACCOUNT.READ`'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.ACCOUNT_MANAGE.READ)
  async handleListDepartments(@User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.listDepartments(user.companyId);
  }

  @Post('auth/department')
  @ApiOperation({
    summary: '新增或更新部門',
    description: ['有帶 `ID` 就是更新。部門代號在公司內唯一。', '', '所需權限：`ACCOUNT.UPDATE`'].join('\n')
  })
  @ApiBody({
    type: UpsertDepartmentDto,
    examples: { create: { summary: '新增', value: { KEY: 'S1', NAME: '第一工務段' } } }
  })
  @ApiResponse({ status: 201, description: '已建立或更新' })
  @ApiCommonErrors({ conflict: '部門代號已存在', notFound: '找不到部門或上層部門' })
  @Audit({ action: 'AUTH', keys: ['ID', 'KEY', 'NAME'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.UPDATE)
  async handleUpsertDepartment(@Body() dto: UpsertDepartmentDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.upsertDepartment(dto, user.companyId);
  }

  // ═══ API Key ══════════════════════════════════════════════════

  @Get('auth/api-key')
  @ApiOperation({
    summary: '查詢 API Key',
    description: [
      '登入者所屬公司核發過的金鑰。只顯示前綴，明文核發後不再保存。',
      '',
      '所需權限：`API_KEY.MANAGE`'
    ].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  @RequireAction(ACTION.API_KEY.MANAGE)
  async handleListApiKeys(@User() user: AuthUser): Promise<HttpResult> {
    return await this.apiKeyService.list(user.companyId);
  }

  @Post('auth/api-key')
  @ApiOperation({
    summary: '核發 API Key',
    description: [
      '給車機、App 後端與對接系統用。金鑰的 `SCOPES` 就是它的權限，只能核發自己有的。',
      '',
      '**明文只在這次回應中出現一次**。使用時放在 `X-Api-Key` 表頭，',
      '只有標註接受金鑰的端點(上傳案件、上傳軌跡、App 收案)會收。',
      '',
      '所需權限：`API_KEY.MANAGE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateApiKeyDto,
    examples: {
      device: { summary: '車機', value: { NAME: '巡查一號車車機', SCOPES: ['CASE.CREATE', 'TRACK.CREATE'] } }
    }
  })
  @ApiResponse({ status: 201, description: '已核發；`data.KEY` 為明文，只出現這一次' })
  @ApiCommonErrors({ badRequest: '試圖核發自己沒有的權限' })
  @Audit({ action: 'AUTH', keys: ['NAME', 'SCOPES'] })
  @RequireAction(ACTION.API_KEY.MANAGE)
  async handleCreateApiKey(@Body() dto: CreateApiKeyDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.apiKeyService.create(dto, user);
  }

  @Delete('auth/api-key/:ID')
  @ApiOperation({
    summary: '停用 API Key',
    description: ['停用而不刪除：稽核要查得到這把金鑰存在過。最多一分鐘內生效。', '', '所需權限：`API_KEY.MANAGE`'].join(
      '\n'
    )
  })
  @ApiParam({ name: 'ID', example: 1 })
  @ApiResponse({ status: 200, description: '已停用' })
  @ApiCommonErrors({ notFound: '找不到該金鑰' })
  @Audit({ action: 'AUTH', keys: [] })
  @RequireAction(ACTION.API_KEY.MANAGE)
  async handleRevokeApiKey(@Param('ID', ParseIntPipe) id: number, @User() user: AuthUser): Promise<HttpResult> {
    return await this.apiKeyService.revoke(id, user.companyId);
  }
}
