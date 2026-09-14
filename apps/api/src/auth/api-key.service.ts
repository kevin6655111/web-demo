import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@/redis/redis.service';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { ApiKey } from './entities/api-key.entity';
import type { AuthUser } from '@app-types/user-auth.type';
import { CreateApiKeyDto } from './auth.dto';

/** 驗證結果快取多久：金鑰被停用後最多晚這麼久才失效 */
const VERIFY_CACHE_MS = 60_000;
/** 「最後使用時間」多久寫一次：每個請求都 UPDATE 會讓上傳端點多一趟寫入 */
const TOUCH_INTERVAL_MS = 5 * 60_000;

type VerifiedKey = { id: number; name: string; companyId: number; scopes: string[] };

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger('ApiKey');
  private readonly lastTouch = new Map<number, number>();

  constructor(
    @InjectRepository(ApiKey) private readonly keyRepo: Repository<ApiKey>,
    private readonly redisService: RedisService
  ) {}

  /**
   * 核發。
   *
   * 明文只在這裡出現一次：回傳後就只剩雜湊。
   * 前綴 `rp_` 讓日誌與設定檔裡看得出「這是本系統的金鑰」，秘密掃描工具也抓得到。
   */
  public async create(dto: CreateApiKeyDto, user: AuthUser): Promise<HttpResult> {
    // 只能核發自己有的權限：金鑰不會憑空長出使用者沒有的能力
    const owned = new Set(user.actions ?? []);
    const denied = dto.SCOPES.filter((s) => !owned.has(s));
    if (denied.length) throw new UnauthorizedException(`無法核發自己沒有的權限：${denied.join(', ')}`);

    const plain = `rp_${randomBytes(24).toString('base64url')}`;
    const saved = await this.keyRepo.save(
      this.keyRepo.create({
        company: { id: user.companyId },
        name: dto.NAME,
        prefix: plain.slice(0, 10),
        keyHash: this.hash(plain),
        scopes: dto.SCOPES,
        expiresAt: dto.EXPIRES_AT ? new Date(dto.EXPIRES_AT) : undefined,
        createdBy: { id: user.uid } as never,
        isActive: true
      })
    );

    this.logger.log(`🔑 核發 API Key #${saved.id} ${saved.name}(${saved.prefix}…) by ${user.account}`);

    return HttpResponse.success({
      message: '金鑰已核發；明文只顯示這一次，請立即保存',
      data: { ID: saved.id, NAME: saved.name, PREFIX: saved.prefix, KEY: plain, SCOPES: saved.scopes }
    });
  }

  public async list(companyId: number): Promise<HttpResult> {
    const rows = await this.keyRepo.find({
      where: { company: { id: companyId } },
      relations: { createdBy: true },
      order: { id: 'DESC' }
    });

    return HttpResponse.successOrWarn({
      data: rows.map((k) => ({
        ID: k.id,
        NAME: k.name,
        PREFIX: k.prefix,
        SCOPES: k.scopes,
        IS_ACTIVE: k.isActive,
        LAST_USED_AT: k.lastUsedAt ?? null,
        EXPIRES_AT: k.expiresAt ?? null,
        CREATED_BY: k.createdBy?.name ?? null,
        CREATED_AT: k.createdAt
      })),
      warnMsg: '尚未核發任何金鑰'
    });
  }

  /** 停用而不刪除：稽核要查得到「這把金鑰存在過、送過哪些資料」 */
  public async revoke(id: number, companyId: number): Promise<HttpResult> {
    const key = await this.keyRepo.findOne({ where: { id, company: { id: companyId } } });
    if (!key) throw new NotFoundException(`找不到金鑰：${id}`);

    await this.keyRepo.update({ id }, { isActive: false });
    await this.redisService.del(this.cacheKey(key.keyHash));

    return HttpResponse.success({ message: `金鑰 ${key.name} 已停用` });
  }

  /**
   * 驗證並換成使用者身分。
   *
   * 回傳的 AuthUser 用 uid 0 與 `key:` 前綴的帳號：
   * 稽核紀錄一眼看得出是機器送的，而 uid 0 在任何關聯上都對不到人。
   */
  public async authenticate(plain: string): Promise<AuthUser> {
    const hash = this.hash(plain);
    const verified = await this.verify(hash);
    if (!verified) throw new UnauthorizedException('API Key 無效或已停用');

    this.touch(verified.id);

    return {
      uid: 0,
      account: `key:${verified.name}`,
      name: verified.name,
      companyId: verified.companyId,
      roleName: 'API_KEY',
      actions: verified.scopes
    };
  }

  private async verify(hash: string): Promise<VerifiedKey | null> {
    const { value } = await this.redisService.remember(this.cacheKey(hash), VERIFY_CACHE_MS, async () => {
      const key = await this.keyRepo.findOne({ where: { keyHash: hash, isActive: true }, relations: { company: true } });
      if (!key || !key.company.isActive) return null;
      if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

      return { id: key.id, name: key.name, companyId: key.company.id, scopes: key.scopes } satisfies VerifiedKey;
    });

    return value;
  }

  /** 節流更新最後使用時間 */
  private touch(id: number): void {
    const now = Date.now();
    if (now - (this.lastTouch.get(id) ?? 0) < TOUCH_INTERVAL_MS) return;

    this.lastTouch.set(id, now);
    void this.keyRepo.update({ id }, { lastUsedAt: new Date() }).catch(() => undefined);
  }

  private hash(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  private cacheKey(hash: string): string {
    return `apikey:${hash.slice(0, 32)}`;
  }
}
