import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { EnvService } from '@/env/env.service';
import { AuthTokenService } from '@/util/auth-token.service';
import { LoginGuardService } from '@/security/login-guard.service';
import { CaseEncodeService } from '@/case-encode/case-encode.service';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { User } from '@entities/user.entity';
import { Role } from '@entities/role.entity';
import { Company } from '@entities/company.entity';
import { Department } from './entities/department.entity';
import { PasswordHistory } from './entities/password-history.entity';
import { UserActionOverride } from './entities/user-action-override.entity';
import { CompanyTreeService } from './company-tree.service';
import type { AuthUser, LoginResult } from '@app-types/user-auth.type';
import {
  ChangePasswordDto,
  CreateAccountDto,
  OrgUserQueryDto,
  ResetPasswordDto,
  SetAccountActiveDto,
  SetActionOverridesDto,
  UpdateAccountDto,
  UpsertDepartmentDto,
  UserAuthenticateDto
} from './auth.dto';

/** 讓 bcrypt 對「查無帳號」也花掉相近的時間 */
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(PasswordHistory) private readonly historyRepo: Repository<PasswordHistory>,
    @InjectRepository(UserActionOverride) private readonly overrideRepo: Repository<UserActionOverride>,
    private readonly authTokenService: AuthTokenService,
    private readonly loginGuardService: LoginGuardService,
    private readonly envService: EnvService,
    private readonly companyTreeService: CompanyTreeService,
    private readonly caseEncodeService: CaseEncodeService,
    private readonly dataSource: DataSource
  ) {}

  // ═══ 登入與憑證 ═══════════════════════════════════════════════

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

    // 帳號不存在時也做一次雜湊比對：讓「查無帳號」與「密碼錯誤」花掉差不多的時間
    const passed = await bcrypt.compare(dto.PASSWORD, user?.password ?? DUMMY_HASH);

    if (!user || !passed) {
      const { locked, remaining } = await this.loginGuardService.recordFailure(companyKey, dto.ACCOUNT);
      throw new UnauthorizedException(
        locked ? '嘗試次數過多，帳號已暫時鎖定 15 分鐘' : `帳號或密碼錯誤(剩餘 ${remaining} 次)`
      );
    }

    this.assertAccountUsable(user);

    // 公司被上層停用時，底下所有帳號一起失效 —— 合約中止不該還登得進來。
    // 訊息不提到「上層」：廠商不需要知道是誰停用了它
    if (!user.company.isActive) throw new UnauthorizedException('單位已停用，請聯繫管理單位');

    await this.loginGuardService.clear(companyKey, dto.ACCOUNT);

    const payload = await this.buildPayload(user);
    const token = this.authTokenService.jwtSign(payload);
    const expiresInSec = this.envService.getTokenExpirationSec();

    this.writeCookie(res, token, expiresInSec);
    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    return HttpResponse.success({
      message: '登入成功',
      data: {
        token,
        expiresInSec,
        user: payload,
        mustChangePassword: this.mustChangePassword(user),
        homeSys: user.homeSys ?? null
      }
    });
  }

  /**
   * 續期 Token。
   *
   * 「還在有效期內才能換新的」：關掉瀏覽器隔天回來仍要重新登入。
   * 換發時重新讀一次角色與覆蓋：管理員剛調整過的權限會在這一刻生效。
   */
  public async refreshToken(user: AuthUser, res: Response): Promise<HttpResult<LoginResult>> {
    const fresh = await this.userRepo.findOne({
      where: { id: user.uid, active: true },
      relations: { company: true, role: true }
    });
    if (!fresh) throw new UnauthorizedException('帳號已停用或不存在');
    if (!fresh.company.isActive) throw new UnauthorizedException('單位已停用，請聯繫管理單位');
    this.assertAccountUsable(fresh);

    const payload = await this.buildPayload(fresh);
    const token = this.authTokenService.jwtSign(payload);
    const expiresInSec = this.envService.getTokenExpirationSec();
    this.writeCookie(res, token, expiresInSec);

    return HttpResponse.success({
      message: '已續期',
      data: { token, expiresInSec, user: payload, mustChangePassword: this.mustChangePassword(fresh) }
    });
  }

  /**
   * 臨時 Token。
   *
   * 給外部系統嵌入用：效期短、權限只有唯讀，而且**不寫入 cookie** ——
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
  public async getUserPrefs(user: AuthUser): Promise<HttpResult> {
    const row = await this.userRepo.findOne({
      where: { id: user.uid },
      relations: { department: true, manager: true }
    });

    return HttpResponse.success({
      data: {
        ...user,
        mustChangePassword: row ? this.mustChangePassword(row) : false,
        homeSys: row?.homeSys ?? null,
        employeeNo: row?.employeeNo ?? null,
        department: row?.department?.name ?? null,
        jobTitle: row?.jobTitle ?? null,
        email: row?.email ?? null
      }
    });
  }

  /** 登出：清掉 cookie */
  public logout(res: Response): HttpResult {
    res.clearCookie('token');
    return HttpResponse.success({ message: '已登出' });
  }

  // ═══ 密碼政策 ═════════════════════════════════════════════════

  /**
   * 使用者改自己的密碼。
   *
   * 三條規則：
   *   - 24 小時冷卻 —— 擋掉「被要求改密碼就改兩次改回原本的」
   *   - 不可與最近三次相同 —— 靠 password_histories
   *   - 強度 —— 長度、字元類型、不含帳號
   *
   * 首次登入(必須改密碼)不受冷卻限制：那正是要他改的時候。
   */
  public async changePassword(dto: ChangePasswordDto, user: AuthUser): Promise<HttpResult> {
    const row = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: user.uid })
      .getOne();
    if (!row) throw new NotFoundException('找不到帳號');

    if (!(await bcrypt.compare(dto.OLD_PASSWORD, row.password))) throw new UnauthorizedException('目前密碼錯誤');

    const policy = this.envService.getAppConfig().password;
    const cooldownMs = (policy.cooldownHours ?? 24) * 3600_000;

    if (!row.mustChangePassword && row.passwordChangedAt && Date.now() - row.passwordChangedAt.getTime() < cooldownMs) {
      const hours = Math.ceil((cooldownMs - (Date.now() - row.passwordChangedAt.getTime())) / 3600_000);
      throw new BadRequestException(`密碼在 ${policy.cooldownHours ?? 24} 小時內只能更改一次，請於 ${hours} 小時後再試`);
    }

    await this.applyNewPassword(row, dto.NEW_PASSWORD, false);

    return HttpResponse.success({ message: '密碼已更新' });
  }

  /**
   * 管理者重設密碡。
   *
   * 沒給密碼就產生一組隨機的、只回傳這一次；無論哪一種，
   * 都會標記「下次登入必須改」—— 管理者不該知道別人長期使用的密碼。
   */
  public async resetPassword(dto: ResetPasswordDto, admin: AuthUser): Promise<HttpResult> {
    const row = await this.userRepo.findOne({ where: { id: dto.ID, company: { id: admin.companyId } } });
    if (!row) throw new NotFoundException(`找不到帳號：${dto.ID}`);

    const plain = dto.PASSWORD ?? this.randomPassword();
    // 管理者重設不受冷卻與歷史限制：那是「這個人被鎖在外面」的救援路徑
    await this.applyNewPassword(row, plain, true, { skipHistoryCheck: true });

    this.logger.warn(`🔑 ${admin.account} 重設了 ${row.account} 的密碼`);

    return HttpResponse.success({
      message: '密碼已重設，該帳號下次登入必須更改',
      data: { ID: row.id, ACCOUNT: row.account, TEMP_PASSWORD: dto.PASSWORD ? undefined : plain }
    });
  }

  /** 寫入新密碼：檢查強度與歷史、更新雜湊、留下歷史 */
  private async applyNewPassword(
    row: User,
    plain: string,
    mustChange: boolean,
    opts: { skipHistoryCheck?: boolean } = {}
  ): Promise<void> {
    const policy = this.envService.getAppConfig().password;
    this.assertPasswordStrength(plain, policy.minLength, row.account);

    const depth = policy.historyDepth ?? 3;

    if (!opts.skipHistoryCheck) {
      const recent = await this.historyRepo.find({
        where: { user: { id: row.id } },
        order: { createdAt: 'DESC' },
        take: depth
      });

      for (const h of recent) {
        if (await bcrypt.compare(plain, h.passwordHash)) {
          throw new BadRequestException(`新密碼不可與最近 ${depth} 次使用過的相同`);
        }
      }
    }

    const hash = await bcrypt.hash(plain, policy.saltRounds);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(User)
        .update({ id: row.id }, { password: hash, passwordChangedAt: new Date(), mustChangePassword: mustChange });

      const histRepo = manager.getRepository(PasswordHistory);
      await histRepo.save(histRepo.create({ user: { id: row.id }, passwordHash: hash }));

      // 只留政策需要的筆數：這張表沒有別的用途，留越多只是多一份要保護的雜湊
      const stale = await histRepo.find({
        where: { user: { id: row.id } },
        order: { createdAt: 'DESC' },
        skip: depth,
        take: 100
      });
      if (stale.length) await histRepo.delete(stale.map((s) => s.id));
    });
  }

  /**
   * 密碼強度檢查。
   *
   * 只擋三件事：太短、只有一種字元類型、跟帳號一樣。
   * 不強制符號 —— 那會把人逼去寫在便利貼上，實務上反而更不安全
   * (NIST SP 800-63B 的結論也是如此)。
   */
  private assertPasswordStrength(password: string, minLength: number, account: string): void {
    if (password.length < minLength) throw new BadRequestException(`密碼至少 ${minLength} 碼`);

    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
    if (kinds < 2) throw new BadRequestException('密碼需混合英文字母與數字(或符號)');

    if (password.toLowerCase().includes(account.toLowerCase())) throw new BadRequestException('密碼不可包含帳號');
  }

  /** 是否必須改密碼：被標記、或超過有效天數 */
  private mustChangePassword(row: User): boolean {
    if (row.mustChangePassword) return true;

    const maxAgeDays = this.envService.getAppConfig().password.maxAgeDays ?? 0;
    if (!maxAgeDays || !row.passwordChangedAt) return false;

    return Date.now() - row.passwordChangedAt.getTime() > maxAgeDays * 86400_000;
  }

  /** 隨機密碼：三種字元類型都有，過得了強度檢查 */
  private randomPassword(): string {
    const body = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
    return `Tp${body}7!`;
  }

  /** 停用、到期、離職 —— 三種「這個人不該再登入」的情況 */
  private assertAccountUsable(row: User): void {
    if (!row.active) throw new UnauthorizedException('帳號已停用');
    if (row.expireAt && row.expireAt.getTime() < Date.now()) throw new UnauthorizedException('帳號已到期');
    if (row.leaveDate && new Date(row.leaveDate).getTime() < Date.now() - 86400_000)
      throw new UnauthorizedException('帳號已離職停用');
  }

  private writeCookie(res: Response, token: string, expiresInSec: number): void {
    // httpOnly 讓 XSS 拿不到 token；sameSite=strict 讓跨站請求帶不出 cookie(等於擋掉 CSRF)；
    // 正式環境強制 secure，避免在明文連線上外洩
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.envService.getNodeEnv() === 'production',
      path: '/',
      maxAge: expiresInSec * 1000
    });
  }

  // ═══ 權限組裝 ═════════════════════════════════════════════════

  /**
   * 組 JWT payload。
   *
   * 權限 = 角色 ∩ 公司開通，再套個人覆蓋：
   *   額外開啟的仍要在公司開通清單內(覆蓋開不出上層沒開通的功能)
   *   明確撤銷的一律拿掉
   */
  private async buildPayload(user: User): Promise<AuthUser> {
    const base = await this.companyTreeService.resolveUserActions(user.company.id, user.role?.actions ?? []);
    const actions = await this.applyOverrides(user.id, user.company.id, base);

    return {
      uid: user.id,
      account: user.account,
      name: user.name,
      companyId: user.company.id,
      roleName: user.role?.name ?? '',
      actions
    };
  }

  private async applyOverrides(userId: number, companyId: number, base: string[]): Promise<string[]> {
    const overrides = await this.overrideRepo.find({ where: { user: { id: userId } } });
    if (!overrides.length) return base;

    const grantable = new Set(await this.companyTreeService.getGrantableActions(companyId));
    const result = new Set(base);

    for (const o of overrides) {
      if (o.isGranted) {
        if (grantable.has(o.actionKey)) result.add(o.actionKey);
      } else {
        result.delete(o.actionKey);
      }
    }

    return [...result];
  }

  /** 查詢某人的個人授權覆蓋 */
  public async getActionOverrides(userId: number, companyId: number): Promise<HttpResult> {
    const target = await this.userRepo.findOne({ where: { id: userId, company: { id: companyId } } });
    if (!target) throw new NotFoundException(`找不到帳號：${userId}`);

    const rows = await this.overrideRepo.find({
      where: { user: { id: userId } },
      relations: { grantedBy: true },
      order: { actionKey: 'ASC' }
    });

    return HttpResponse.successOrWarn({
      data: rows.map((o) => ({
        ACTION_KEY: o.actionKey,
        IS_GRANTED: o.isGranted,
        REASON: o.reason ?? null,
        GRANTED_BY: o.grantedBy?.name ?? null,
        UPDATED_AT: o.updatedAt
      })),
      warnMsg: '此帳號沒有個人授權覆蓋'
    });
  }

  /**
   * 設定個人授權覆蓋(整份取代)。
   *
   * 整份而不是逐筆：畫面上是一張勾選矩陣，使用者改完一次送出。
   * 逐筆 API 會讓「取消勾選」需要另一支刪除端點。
   */
  public async setActionOverrides(dto: SetActionOverridesDto, admin: AuthUser): Promise<HttpResult> {
    const target = await this.userRepo.findOne({ where: { id: dto.USER_ID, company: { id: admin.companyId } } });
    if (!target) throw new NotFoundException(`找不到帳號：${dto.USER_ID}`);

    // 只能開自己有的：管理者不能替別人開出自己沒有的權限
    const owned = new Set(admin.actions ?? []);
    const denied = dto.OVERRIDES.filter((o) => o.IS_GRANTED && !owned.has(o.ACTION_KEY)).map((o) => o.ACTION_KEY);
    if (denied.length) throw new BadRequestException(`無法開啟自己沒有的權限：${denied.join(', ')}`);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserActionOverride);
      await repo.delete({ user: { id: dto.USER_ID } });

      if (dto.OVERRIDES.length) {
        await repo.save(
          dto.OVERRIDES.map((o) =>
            repo.create({
              user: { id: dto.USER_ID },
              actionKey: o.ACTION_KEY,
              isGranted: o.IS_GRANTED,
              reason: o.REASON,
              grantedBy: { id: admin.uid } as never
            })
          )
        );
      }
    });

    return HttpResponse.success({ message: `已更新 ${dto.OVERRIDES.length} 筆個人授權`, data: { COUNT: dto.OVERRIDES.length } });
  }

  // ═══ 帳號管理 ═════════════════════════════════════════════════

  /** 查詢所屬公司的人員 */
  public async getOrgUser(dto: OrgUserQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'r')
      .leftJoinAndSelect('u.department', 'd')
      .leftJoinAndSelect('u.manager', 'm')
      .where('u.company_id = :companyId', { companyId })
      .orderBy('u.id', 'ASC');

    if (dto.KEYWORD) {
      qb.andWhere('(u.name ILIKE :kw OR u.account ILIKE :kw OR u.employee_no ILIKE :kw OR u.email ILIKE :kw)', {
        kw: `%${dto.KEYWORD}%`
      });
    }
    if (dto.DEPARTMENT_ID) qb.andWhere('u.department_id = :dept', { dept: dto.DEPARTMENT_ID });
    if (dto.ROLE_KEY) qb.andWhere('r.key = :roleKey', { roleKey: dto.ROLE_KEY });
    if (dto.ACTIVE !== undefined) qb.andWhere('u.active = :active', { active: dto.ACTIVE });

    const rows = await qb.getMany();

    // 覆蓋數量一次查完：列表上要標出「這個人有例外」，逐筆查是 N+1
    const overrideCounts = rows.length
      ? await this.overrideRepo
          .createQueryBuilder('o')
          .select('o.user_id', 'userId')
          .addSelect('COUNT(*)::int', 'count')
          .where('o.user_id IN (:...ids)', { ids: rows.map((u) => u.id) })
          .groupBy('o.user_id')
          .getRawMany<{ userId: number; count: number }>()
      : [];
    const overrideMap = new Map(overrideCounts.map((o) => [Number(o.userId), o.count]));

    return HttpResponse.successOrWarn({
      data: rows.map((u) => ({
        ID: u.id,
        ACCOUNT: u.account,
        USER_NAME: u.name,
        ENGLISH_NAME: u.englishName ?? null,
        EMPLOYEE_NO: u.employeeNo ?? null,
        EMAIL: u.email ?? null,
        JOB_TITLE: u.jobTitle ?? null,
        ROLE: u.role?.name ?? '',
        ROLE_KEY: u.role?.key ?? null,
        DEPARTMENT: u.department?.name ?? null,
        DEPARTMENT_ID: u.department?.id ?? null,
        MANAGER: u.manager?.name ?? null,
        MANAGER_ID: u.manager?.id ?? null,
        HIRE_DATE: u.hireDate ?? null,
        LEAVE_DATE: u.leaveDate ?? null,
        HOME_SYS: u.homeSys ?? null,
        EXPIRE_AT: u.expireAt ?? null,
        ACTIVE: u.active,
        MUST_CHANGE_PASSWORD: this.mustChangePassword(u),
        PASSWORD_CHANGED_AT: u.passwordChangedAt ?? null,
        OVERRIDE_COUNT: overrideMap.get(u.id) ?? 0,
        LAST_LOGIN_AT: u.lastLoginAt ?? null
      }))
    });
  }

  /**
   * 新增帳號。
   *
   * 員工編號由系統產生(公司代號 + 年 + 流水)，走 caseEncodeService 保證併發不撞號。
   * 新帳號一律標記「首次登入必須改密碼」：初始密碼是管理者知道的，不該長期使用。
   */
  public async createAccount(dto: CreateAccountDto, admin: AuthUser): Promise<HttpResult> {
    const companyId = admin.companyId;
    const policy = this.envService.getAppConfig().password;

    const exists = await this.userRepo.exists({ where: { account: dto.ACCOUNT, company: { id: companyId } } });
    if (exists) throw new ConflictException(`帳號已存在：${dto.ACCOUNT}`);

    const company = await this.companyRepo.findOneByOrFail({ id: companyId });

    // 人員額度是上層開通的一部分：超過就是該去申請，不是偷偷多建一個
    const count = await this.userRepo.count({ where: { company: { id: companyId } } });
    if (count >= company.userLimit) throw new ConflictException(`已達人員額度上限(${company.userLimit} 人)`);

    const role = await this.roleRepo.findOneBy({ key: dto.ROLE_KEY });
    if (!role) throw new NotFoundException(`找不到角色：${dto.ROLE_KEY}`);

    await this.assertProfileRefs(dto, companyId);

    const plain = dto.PASSWORD ?? this.randomPassword();
    this.assertPasswordStrength(plain, policy.minLength, dto.ACCOUNT);

    const saved = await this.dataSource.transaction(async (manager) => {
      const employeeNo = await this.generateEmployeeNo(company, manager);
      const hash = await bcrypt.hash(plain, policy.saltRounds);

      const userRepo = manager.getRepository(User);
      const row = await userRepo.save(
        userRepo.create({
          company,
          role,
          account: dto.ACCOUNT,
          name: dto.USER_NAME,
          password: hash,
          active: true,
          employeeNo,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          ...this.profilePatch(dto)
        })
      );

      const histRepo = manager.getRepository(PasswordHistory);
      await histRepo.save(histRepo.create({ user: { id: row.id }, passwordHash: hash }));

      return row;
    });

    return HttpResponse.success({
      message: '帳號已建立，首次登入須更改密碼',
      data: { ID: saved.id, EMPLOYEE_NO: saved.employeeNo, TEMP_PASSWORD: dto.PASSWORD ? undefined : plain }
    });
  }

  /** 更新帳號資料(不含密碼與啟用狀態，那兩件事各有自己的端點) */
  public async updateAccount(dto: UpdateAccountDto, companyId: number): Promise<HttpResult> {
    const row = await this.userRepo.findOne({ where: { id: dto.ID, company: { id: companyId } } });
    if (!row) throw new NotFoundException(`找不到帳號：${dto.ID}`);

    await this.assertProfileRefs(dto, companyId, dto.ID);

    const patch: Partial<User> = { ...this.profilePatch(dto) };
    if (dto.USER_NAME !== undefined) patch.name = dto.USER_NAME;

    if (dto.ROLE_KEY !== undefined) {
      const role = await this.roleRepo.findOneBy({ key: dto.ROLE_KEY });
      if (!role) throw new NotFoundException(`找不到角色：${dto.ROLE_KEY}`);
      patch.role = role;
    }

    if (!Object.keys(patch).length) throw new BadRequestException('沒有要更新的欄位');

    await this.userRepo.update({ id: dto.ID }, patch);

    return HttpResponse.success({ message: '帳號已更新', data: { ID: dto.ID } });
  }

  /** 啟用/停用帳號 */
  public async setAccountActive(dto: SetAccountActiveDto, companyId: number): Promise<HttpResult> {
    const result = await this.userRepo.update({ id: dto.ID, company: { id: companyId } }, { active: dto.ACTIVE });
    if (!result.affected) throw new NotFoundException(`找不到帳號：${dto.ID}`);

    return HttpResponse.success({ message: dto.ACTIVE ? '帳號已啟用' : '帳號已停用' });
  }

  /** 人員資料欄位 → 實體欄位；只帶有送的 */
  private profilePatch(dto: Partial<UpdateAccountDto>): Partial<User> {
    const patch: Partial<User> = {};

    if (dto.DEPARTMENT_ID !== undefined) patch.department = dto.DEPARTMENT_ID ? ({ id: dto.DEPARTMENT_ID } as never) : null;
    if (dto.MANAGER_ID !== undefined) patch.manager = dto.MANAGER_ID ? ({ id: dto.MANAGER_ID } as never) : null;
    if (dto.ENGLISH_NAME !== undefined) patch.englishName = dto.ENGLISH_NAME;
    if (dto.EMAIL !== undefined) patch.email = dto.EMAIL;
    if (dto.JOB_TITLE !== undefined) patch.jobTitle = dto.JOB_TITLE;
    if (dto.HIRE_DATE !== undefined) patch.hireDate = dto.HIRE_DATE;
    if (dto.LEAVE_DATE !== undefined) patch.leaveDate = dto.LEAVE_DATE;
    if (dto.HOME_SYS !== undefined) patch.homeSys = dto.HOME_SYS;
    if (dto.EXPIRE_AT !== undefined) patch.expireAt = dto.EXPIRE_AT ? new Date(dto.EXPIRE_AT) : undefined;

    return patch;
  }

  /** 部門與主管必須在同一間公司；離職日不可早於入職日 */
  private async assertProfileRefs(dto: Partial<UpdateAccountDto>, companyId: number, selfId?: number): Promise<void> {
    if (dto.DEPARTMENT_ID) {
      const ok = await this.departmentRepo.exists({ where: { id: dto.DEPARTMENT_ID, company: { id: companyId } } });
      if (!ok) throw new NotFoundException(`找不到部門：${dto.DEPARTMENT_ID}`);
    }

    if (dto.MANAGER_ID) {
      if (dto.MANAGER_ID === selfId) throw new BadRequestException('主管不能是自己');
      const ok = await this.userRepo.exists({ where: { id: dto.MANAGER_ID, company: { id: companyId } } });
      if (!ok) throw new NotFoundException(`找不到主管：${dto.MANAGER_ID}`);
    }

    if (dto.HIRE_DATE && dto.LEAVE_DATE && dto.LEAVE_DATE < dto.HIRE_DATE) {
      throw new BadRequestException('離職日不能早於入職日');
    }
  }

  /**
   * 員工編號：`<公司代號><西元年><四碼流水>`。
   *
   * 走案件編號同一套計數器：同一天兩個管理者同時建帳號也不會撞號。
   */
  private async generateEmployeeNo(company: Company, manager: import('typeorm').EntityManager): Promise<string> {
    const year = String(new Date().getFullYear());
    // 計數器的前綴加上 `EMP-` 做命名空間：標案號也走同一張計數表，
    // 不隔開的話，一個叫 `DEMO` 的標案會跟公司 `DEMO` 的員工編號共用同一條流水
    const prefix = `EMP-${company.code}`;
    const seq = await this.caseEncodeService.next({ prefix, seqDate: year, pad: 4 }, manager);

    return `${company.code}${seq.slice(prefix.length)}`;
  }

  // ═══ 部門 ═════════════════════════════════════════════════════

  public async listDepartments(companyId: number): Promise<HttpResult> {
    const rows = await this.departmentRepo.find({
      where: { company: { id: companyId } },
      relations: { parent: true },
      order: { key: 'ASC' }
    });

    const counts = rows.length
      ? await this.userRepo
          .createQueryBuilder('u')
          .select('u.department_id', 'deptId')
          .addSelect('COUNT(*)::int', 'count')
          .where('u.company_id = :companyId', { companyId })
          .andWhere('u.department_id IS NOT NULL')
          .groupBy('u.department_id')
          .getRawMany<{ deptId: number; count: number }>()
      : [];
    const countMap = new Map(counts.map((c) => [Number(c.deptId), c.count]));

    return HttpResponse.successOrWarn({
      data: rows.map((d) => ({
        ID: d.id,
        KEY: d.key,
        NAME: d.name,
        PARENT_ID: d.parent?.id ?? null,
        PARENT_NAME: d.parent?.name ?? null,
        IS_ACTIVE: d.isActive,
        USER_COUNT: countMap.get(d.id) ?? 0
      })),
      warnMsg: '尚未建立部門'
    });
  }

  public async upsertDepartment(dto: UpsertDepartmentDto, companyId: number): Promise<HttpResult> {
    const duplicate = await this.departmentRepo
      .createQueryBuilder('d')
      .where('d.company_id = :companyId', { companyId })
      .andWhere('d.key = :key', { key: dto.KEY })
      .andWhere(dto.ID ? 'd.id != :id' : '1=1', dto.ID ? { id: dto.ID } : {})
      .getOne();
    if (duplicate) throw new ConflictException(`部門代號已存在：${dto.KEY}`);

    if (dto.PARENT_ID) {
      if (dto.PARENT_ID === dto.ID) throw new BadRequestException('上層部門不能是自己');
      const ok = await this.departmentRepo.exists({ where: { id: dto.PARENT_ID, company: { id: companyId } } });
      if (!ok) throw new NotFoundException(`找不到上層部門：${dto.PARENT_ID}`);
    }

    const payload = {
      company: { id: companyId },
      key: dto.KEY,
      name: dto.NAME,
      parent: dto.PARENT_ID ? ({ id: dto.PARENT_ID } as never) : null,
      isActive: dto.IS_ACTIVE ?? true
    };

    if (dto.ID) {
      const result = await this.departmentRepo.update({ id: dto.ID, company: { id: companyId } }, payload);
      if (!result.affected) throw new NotFoundException(`找不到部門：${dto.ID}`);
      return HttpResponse.success({ message: '部門已更新', data: { ID: dto.ID } });
    }

    const saved = await this.departmentRepo.save(this.departmentRepo.create(payload));
    return HttpResponse.success({ message: '部門已建立', data: { ID: saved.id } });
  }
}
