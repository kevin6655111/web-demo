import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { EnvService } from '@/env/env.service';
import { AuthTokenService } from '@/util/auth-token.service';
import { LoginGuardService } from '@/security/login-guard.service';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User } from '@entities/user.entity';
import { Role } from '@entities/role.entity';
import { Company } from '@entities/company.entity';
import { CompanyTreeService } from './company-tree.service';
import type { AuthUser, LoginResult } from '@app-types/user-auth.type';
import { CreateAccountDto, OrgUserQueryDto, SetAccountActiveDto, UserAuthenticateDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    private readonly authTokenService: AuthTokenService,
    private readonly loginGuardService: LoginGuardService,
    private readonly envService: EnvService,
    private readonly companyTreeService: CompanyTreeService
  ) {}

  /**
   * 登入驗證。
   * 帳號不存在與密碼錯誤回傳同一句話，避免被用來枚舉帳號。
   */
  public async userAuthenticate(dto: UserAuthenticateDto, res: Response): Promise<HttpResult<LoginResult>> {
    const companyKey = dto.COMPANY_KEY.toUpperCase();

    // 先看鎖定狀態：被鎖住的帳號連比對密碼都不做，
    // 否則攻擊者還是能靠回應時間差判斷帳號是否存在
    const lockRemain = await this.loginGuardService.getLockRemainSec(companyKey, dto.ACCOUNT);
    if (lockRemain > 0) throw new UnauthorizedException(`嘗試次數過多，請於 ${Math.ceil(lockRemain / 60)} 分鐘後再試`);

    const user = await this.userRepo
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.company', 'c')
      .leftJoinAndSelect('u.role', 'r')
      .addSelect('u.password')
      .where('c.code = :code', { code: companyKey })
      .andWhere('u.account = :account', { account: dto.ACCOUNT })
      .getOne();

    // 帳號不存在時也做一次雜湊比對：讓「查無帳號」與「密碼錯誤」花掉差不多的時間，
    // 不給攻擊者用回應時間枚舉帳號的機會
    const passed = user
      ? await bcrypt.compare(dto.PASSWORD, user.password)
      : await bcrypt.compare(dto.PASSWORD, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

    if (!user || !passed) {
      const { locked, remaining } = await this.loginGuardService.recordFailure(companyKey, dto.ACCOUNT);
      throw new UnauthorizedException(locked ? '嘗試次數過多，帳號已暫時鎖定 15 分鐘' : `帳號或密碼錯誤(剩餘 ${remaining} 次)`);
    }

    if (!user.active) throw new UnauthorizedException('帳號已停用');

    // 公司被上層停用時，底下所有帳號一起失效 —— 合約中止不該還登得進來。
    // 訊息不提到「上層」：廠商不需要知道是誰停用了它
    if (!user.company.isActive) throw new UnauthorizedException('單位已停用，請聯繫管理單位');

    await this.loginGuardService.clear(companyKey, dto.ACCOUNT);

    const payload: AuthUser = {
      uid: user.id,
      account: user.account,
      name: user.name,
      companyId: user.company.id,
      roleName: user.role?.name ?? '',
      // 角色給的動作要再跟「公司被開通的」取交集 ——
      // 少了這一步，廠商自己建一個全權限角色就繞過了上層的開通機制
      actions: await this.companyTreeService.resolveUserActions(user.company.id, user.role?.actions ?? [])
    };

    const token = this.authTokenService.jwtSign(payload);
    const expiresInSec = this.envService.getTokenExpirationSec();

    // Cookie 給瀏覽器，回應主體同時帶 token 給 App 與對接系統
    // httpOnly 讓 XSS 拿不到 token；sameSite=strict 讓跨站請求帶不出 cookie(等於擋掉 CSRF)；
    // 正式環境強制 secure，避免在明文連線上外洩
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.envService.getNodeEnv() === 'production',
      path: '/',
      maxAge: expiresInSec * 1000
    });

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    return HttpResponse.success({ message: '登入成功', data: { token, expiresInSec, user: payload } });
  }

  /**
   * 續期 Token。
   *
   * 使用者在畫面上連續操作了 25 分鐘，不該因為 token 到期就被踢出去 ——
   * 但也不能無限續期，否則等於沒有有效期限。
   * 這裡的折衷是「還在有效期內才能換新的」：關掉瀏覽器隔天回來仍要重新登入。
   *
   * 換發時重新讀一次角色權限：管理員剛調整過的權限會在這一刻生效，
   * 不必等使用者登出再登入。
   */
  public async refreshToken(user: AuthUser, res: Response): Promise<HttpResult<LoginResult>> {
    const fresh = await this.userRepo.findOne({
      where: { id: user.uid, active: true },
      relations: { company: true, role: true }
    });
    if (!fresh) throw new UnauthorizedException('帳號已停用或不存在');
    if (!fresh.company.isActive) throw new UnauthorizedException('單位已停用，請聯繫管理單位');

    const payload: AuthUser = {
      uid: fresh.id,
      account: fresh.account,
      name: fresh.name,
      companyId: fresh.company.id,
      roleName: fresh.role?.name ?? '',
      // 續期時重算交集：上層剛收回的權限會在這一刻生效，
      // 不必等使用者登出再登入
      actions: await this.companyTreeService.resolveUserActions(fresh.company.id, fresh.role?.actions ?? [])
    };

    const token = this.authTokenService.jwtSign(payload);
    const expiresInSec = this.envService.getTokenExpirationSec();

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.envService.getNodeEnv() === 'production',
      path: '/',
      maxAge: expiresInSec * 1000
    });

    return HttpResponse.success({ message: '已續期', data: { token, expiresInSec, user: payload } });
  }

  /**
   * 臨時 Token。
   *
   * 給外部系統嵌入用(例如市府的入口網要開一個統計頁)：
   * 效期短、權限只有唯讀，而且**不寫入 cookie** ——
   * 它是要放進網址或表頭給第三方用的，不該綁在瀏覽器上。
   */
  public createTempToken(user: AuthUser, expiresInSec = 300): HttpResult {
    const readOnly = (user.actions ?? []).filter((a) => a.endsWith('.READ'));

    const token = this.authTokenService.jwtSign({
      uid: user.uid,
      account: user.account,
      name: user.name,
      companyId: user.companyId,
      roleName: `${user.roleName}(臨時)`,
      actions: readOnly
    });

    return HttpResponse.success({ message: '已核發臨時 Token', data: { token, expiresInSec, actions: readOnly } });
  }

  /** 取得登入者資訊(前端刷新頁面時用來回填狀態) */
  public getUserPrefs(user: AuthUser): HttpResult<AuthUser> {
    return HttpResponse.success({ data: user });
  }

  /** 登出：清掉 cookie */
  public logout(res: Response): HttpResult {
    res.clearCookie('token');
    return HttpResponse.success({ message: '已登出' });
  }

  /** 查詢所屬公司的人員 */
  public async getOrgUser(dto: OrgUserQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'r')
      .where('u.company_id = :companyId', { companyId })
      .orderBy('u.id', 'ASC');

    if (dto.KEYWORD) qb.andWhere('(u.name ILIKE :kw OR u.account ILIKE :kw)', { kw: `%${dto.KEYWORD}%` });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((u) => ({
        ID: u.id,
        ACCOUNT: u.account,
        USER_NAME: u.name,
        ROLE: u.role?.name ?? '',
        ACTIVE: u.active,
        LAST_LOGIN_AT: u.lastLoginAt ?? null
      }))
    });
  }

  /** 新增帳號 */
  public async createAccount(dto: CreateAccountDto, companyId: number): Promise<HttpResult> {
    const { minLength, saltRounds } = this.envService.getAppConfig().password;
    this.assertPasswordStrength(dto.PASSWORD, minLength, dto.ACCOUNT);

    const exists = await this.userRepo.exists({ where: { account: dto.ACCOUNT, company: { id: companyId } } });
    if (exists) throw new ConflictException(`帳號已存在：${dto.ACCOUNT}`);

    const company = await this.companyRepo.findOneByOrFail({ id: companyId });
    const role = await this.roleRepo.findOneBy({ key: dto.ROLE_KEY });
    if (!role) throw new NotFoundException(`找不到角色：${dto.ROLE_KEY}`);

    const saved = await this.userRepo.save(
      this.userRepo.create({
        company,
        role,
        account: dto.ACCOUNT,
        name: dto.USER_NAME,
        password: await bcrypt.hash(dto.PASSWORD, saltRounds),
        active: true
      })
    );

    return HttpResponse.success({ message: '帳號已建立', data: { ID: saved.id } });
  }

  /**
   * 密碼強度檢查。
   *
   * 只擋三件事：太短、只有一種字元類型、跟帳號一樣。
   * 不強制符號與定期更換 —— 那兩項會把人逼去寫在便利貼上，
   * 實務上反而讓帳號更容易被盜(NIST SP 800-63B 的結論也是如此)。
   */
  private assertPasswordStrength(password: string, minLength: number, account: string): void {
    if (password.length < minLength) throw new BadRequestException(`密碼至少 ${minLength} 碼`);

    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
    if (kinds < 2) throw new BadRequestException('密碼需混合英文字母與數字(或符號)');

    if (password.toLowerCase().includes(account.toLowerCase())) throw new BadRequestException('密碼不可包含帳號');
  }

  /** 啟用/停用帳號 */
  public async setAccountActive(dto: SetAccountActiveDto, companyId: number): Promise<HttpResult> {
    const result = await this.userRepo.update({ id: dto.ID, company: { id: companyId } }, { active: dto.ACTIVE });
    if (!result.affected) throw new NotFoundException(`找不到帳號：${dto.ID}`);

    return HttpResponse.success({ message: dto.ACTIVE ? '帳號已啟用' : '帳號已停用' });
  }
}
