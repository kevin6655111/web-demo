import { CallHandler, ConflictException, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { createHash } from 'crypto';
import { IDEMPOTENT_META_KEY, type IdempotentMeta } from '@decorators/idempotent.decorator';
import { RedisService } from '@/redis/redis.service';
import type { HttpRequest } from '@app-types/http.type';

type Record_ = { state: 'in-flight' } | { state: 'done'; body: unknown };

/**
 * HTTP 冪等層(第一道)。
 *
 * 車機在隧道裡送出案件、收不到回應就重送 —— 同一筆案件可能連來三次。
 * 標了 @Idempotent 的 API 會依 `Idempotency-Key` 表頭去重：
 *
 *   1. 第一次進來：SET NX 搶到鎖 → 真的執行 → 把回應存回 Redis
 *   2. 重送且前一次已完成：直接回放存下的回應，不再執行
 *   3. 重送且前一次還在跑：回 409，讓上游稍後再試(不能回 200，那會讓上游誤以為完成)
 *
 * 同一把 key 但 body 不同視為誤用，直接 422 —— 這通常是上游的 bug，掩蓋它更危險。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 事件的去重靠佇列的 jobId 與資料庫唯一鍵，不走 HTTP 的 Idempotency-Key
    if (context.getType() !== 'http') return next.handle();

    const meta = this.reflector.get<IdempotentMeta | undefined>(IDEMPOTENT_META_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<HttpRequest>();
    const headerKey = (req.headers['idempotency-key'] as string | undefined)?.trim();

    // 沒帶表頭就退回用 body 內容雜湊：讓沒改造過的上游也有基本保護
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');
    const scope = `${req.user?.companyId ?? 'anon'}:${req.path}`;
    const key = `idem:${scope}:${headerKey ?? bodyHash}`;

    return from(this.begin(key, bodyHash, meta.ttlSec)).pipe(
      switchMap((cached) => {
        if (cached) return of(cached);

        return next.handle().pipe(
          tap({
            next: (body) => void this.finish(key, bodyHash, body, meta.ttlSec),
            // 失敗要把鎖放掉，否則上游重送會一直撞到 409
            error: () => void this.redisService.del(key)
          })
        );
      })
    );
  }

  /** 搶鎖；若已有紀錄，回傳要直接回放的內容 */
  private async begin(key: string, bodyHash: string, ttlSec: number): Promise<unknown | undefined> {
    const got = await this.redisService.acquire(key, ttlSec * 1000, JSON.stringify({ state: 'in-flight', bodyHash }));
    if (got) return undefined;

    const existing = await this.redisService.getJson<Record_ & { bodyHash: string }>(key);
    if (!existing) return undefined; // 剛好過期，讓它重跑

    if (existing.bodyHash !== bodyHash) {
      throw new ConflictException('Idempotency-Key 已用於不同內容的請求');
    }

    if (existing.state === 'in-flight') {
      throw new ConflictException('前一筆相同請求仍在處理中，請稍後重試');
    }

    this.logger.log(`♻️  回放冪等結果: ${key}`);
    return existing.body;
  }

  private async finish(key: string, bodyHash: string, body: unknown, ttlSec: number): Promise<void> {
    await this.redisService.setJson(key, { state: 'done', bodyHash, body }, ttlSec * 1000);
  }
}
