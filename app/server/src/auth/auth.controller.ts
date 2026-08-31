import { Body, Controller, Get, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HttpResult } from '@/http/http-response';
import { Audit } from '@decorators/audit.decorator';
import { User, type AuthUser } from '@decorators/user.decorator';
import { ACTION, RequireAction } from '@decorators/permission.decorator';
import { ApiCommonErrors } from '@decorators/api-error.decorator';
import { API_AUTH } from '@/util/app-swagger';
import { AuthService } from './auth.service';
import { CreateAccountDto, OrgUserQueryDto, SetAccountActiveDto, UserAuthenticateDto } from './auth.dto';

@ApiTags('Auth')
@ApiBearerAuth(API_AUTH)
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  @ApiResponse({ status: 201, description: '登入成功。`data` 含 token、有效秒數與使用者權限' })
  @ApiResponse({ status: 401, description: '帳號或密碼錯誤、帳號已停用，或已被暫時鎖定' })
  @ApiResponse({ status: 429, description: '嘗試過於頻繁' })
  // 登入是攻擊面最大的端點：全域限制擋不住針對單一帳號的慢速嘗試，這裡再收緊一層
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'AUTH', keys: ['COMPANY_KEY', 'ACCOUNT'] })
  async handleUserAuthenticate(@Body() dto: UserAuthenticateDto, @Res({ passthrough: true }) res: Response): Promise<HttpResult> {
    return await this.authService.userAuthenticate(dto, res);
  }

  /** 取得使用者資訊 */
  @Get('auth/user/prefs')
  @ApiOperation({
    summary: '取得登入者資訊',
    description: ['回傳 token 內的身分與權限。前端重新整理後靠這支回填登入狀態 —— token 在 httpOnly cookie 裡，JS 讀不到。', '', '不需額外權限(需已登入)。'].join('\n')
  })
  @ApiResponse({ status: 200, description: '查詢成功' })
  @ApiCommonErrors()
  handleGetPrefs(@User() user: AuthUser): HttpResult {
    return this.authService.getUserPrefs(user);
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
      '換發時重新讀一次角色權限：剛調整過的權限會在這一刻生效，不必登出再登入。',
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
  @ApiOperation({ summary: '登出', description: ['清除 cookie。App 端請自行丟棄 token。', '', '不需額外權限(需已登入)。'].join('\n') })
  @ApiResponse({ status: 201, description: '已登出' })
  @ApiCommonErrors()
  @Audit({ action: 'AUTH', keys: [] })
  handleLogout(@Res({ passthrough: true }) res: Response): HttpResult {
    return this.authService.logout(res);
  }

  /** 查詢所屬公司的人員 */
  @Get('auth/org/user')
  @ApiOperation({
    summary: '查詢公司人員',
    description: ['只回傳登入者所屬公司的帳號。`KEYWORD` 對姓名與帳號做模糊比對。', '', '所需權限：`ACCOUNT.READ`'].join('\n')
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
      '在登入者所屬的公司下建立帳號。',
      '',
      '密碼規則：至少 8 碼、混合兩種以上字元類型、不可包含帳號。',
      '刻意不強制符號與定期更換 —— 那會把人逼去寫便利貼，實務上更不安全。',
      '',
      '所需權限：`ACCOUNT.CREATE`'
    ].join('\n')
  })
  @ApiBody({
    type: CreateAccountDto,
    examples: {
      inspector: { summary: '新增巡查員', value: { ACCOUNT: 'inspector02', USER_NAME: '王小明', PASSWORD: 'Patrol2026', ROLE_KEY: 'INSPECTOR' } }
    }
  })
  @ApiResponse({ status: 201, description: '帳號已建立' })
  @ApiCommonErrors({ badRequest: '參數錯誤: 欄位缺漏，或密碼不符強度規則', notFound: '找不到指定角色', conflict: '帳號已存在' })
  @Audit({ action: 'AUTH', keys: ['ACCOUNT', 'USER_NAME', 'ROLE_KEY'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.CREATE)
  async handleCreateAccount(@Body() dto: CreateAccountDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.createAccount(dto, user.companyId);
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
    examples: { disable: { summary: '停用', value: { ID: 2, ACTIVE: false } }, enable: { summary: '啟用', value: { ID: 2, ACTIVE: true } } }
  })
  @ApiResponse({ status: 200, description: '狀態已更新' })
  @ApiCommonErrors({ notFound: '找不到該帳號' })
  @Audit({ action: 'AUTH', keys: ['ID', 'ACTIVE'] })
  @RequireAction(ACTION.ACCOUNT_MANAGE.DELETE)
  async handleSetAccountActive(@Body() dto: SetAccountActiveDto, @User() user: AuthUser): Promise<HttpResult> {
    return await this.authService.setAccountActive(dto, user.companyId);
  }
}
