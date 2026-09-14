import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '@/http/guards/idempotency.interceptor';
import { Idempotent, IDEMPOTENT_META_KEY } from '@decorators/idempotent.decorator';

/**
 * 冪等層是這個系統最容易被寫壞的地方：
 * 「重送要回同一個結果」和「失敗要能重試」是一組互相拉扯的需求，
 * 所以四種情境都要各有一個測試釘住。
 */

/** 記憶體版 Redis：只實作 SET NX PX / GET / DEL 這三個真的被用到的操作 */
class FakeRedisService {
  private store = new Map<string, string>();

  async acquire(key: string, _ttlMs: number, value = '1'): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** 造一個帶 @Idempotent 標註的假 handler 與請求情境 */
function makeContext(body: unknown, idempotencyKey?: string): ExecutionContext {
  class Target {
    @Idempotent(600)
    handle() {}
  }

  const req = {
    body,
    path: '/api/patrol/case',
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    user: { companyId: 1 }
  };

  return {
    // 攔截器靠 getType 排除微服務事件；假的 context 少了它就整個被跳過
    getType: () => 'http',
    getHandler: () => Target.prototype.handle,
    getClass: () => Target,
    switchToHttp: () => ({ getRequest: () => req })
  } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let redis: FakeRedisService;

  beforeEach(() => {
    redis = new FakeRedisService();
    interceptor = new IdempotencyInterceptor(new Reflector(), redis as any);
  });

  const body = { EXTERNAL_ID: 'DEMO-1', CRACK_TYPE: 'POTHOLE' };

  it('第一次請求會實際執行 handler', async () => {
    let calls = 0;
    const next = {
      handle: () => {
        calls += 1;
        return of({ ID: 7, DUPLICATED: false });
      }
    };

    const result = await firstValueFrom(interceptor.intercept(makeContext(body, 'K1'), next as any));

    expect(calls).toBe(1);
    expect(result).toEqual({ ID: 7, DUPLICATED: false });
  });

  it('相同 key 重送時回放結果，不再執行 handler', async () => {
    let calls = 0;
    const next = {
      handle: () => {
        calls += 1;
        return of({ ID: 7 });
      }
    };

    const ctx = makeContext(body, 'K1');
    await firstValueFrom(interceptor.intercept(ctx, next as any));
    const replayed = await firstValueFrom(interceptor.intercept(makeContext(body, 'K1'), next as any));

    expect(calls).toBe(1); // 關鍵：第二次沒有再進 handler
    expect(replayed).toEqual({ ID: 7 });
  });

  it('相同 key 但內容不同視為誤用，直接擋下', async () => {
    const next = { handle: () => of({ ID: 7 }) };
    await firstValueFrom(interceptor.intercept(makeContext(body, 'K1'), next as any));

    await expect(
      firstValueFrom(interceptor.intercept(makeContext({ ...body, EXTERNAL_ID: 'DEMO-2' }, 'K1'), next as any))
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('handler 失敗時要放掉鎖，讓上游可以重試', async () => {
    const failing = { handle: () => throwError(() => new Error('DB down')) };
    await expect(firstValueFrom(interceptor.intercept(makeContext(body, 'K1'), failing as any))).rejects.toThrow(
      'DB down'
    );

    // 鎖已釋放：同一把 key 重送會真的再跑一次，而不是卡在 409
    let calls = 0;
    const ok = {
      handle: () => {
        calls += 1;
        return of({ ID: 7 });
      }
    };
    await firstValueFrom(interceptor.intercept(makeContext(body, 'K1'), ok as any));

    expect(calls).toBe(1);
  });

  it('沒帶 Idempotency-Key 時退回用 body 雜湊去重', async () => {
    let calls = 0;
    const next = {
      handle: () => {
        calls += 1;
        return of({ ID: 7 });
      }
    };

    await firstValueFrom(interceptor.intercept(makeContext(body), next as any));
    await firstValueFrom(interceptor.intercept(makeContext(body), next as any));

    expect(calls).toBe(1);
  });

  it('沒有 @Idempotent 標註的 handler 不受影響', async () => {
    class Plain {
      handle() {}
    }
    const ctx = {
      getType: () => 'http',
      getHandler: () => Plain.prototype.handle,
      getClass: () => Plain,
      switchToHttp: () => ({ getRequest: () => ({ body, path: '/api/x', headers: {} }) })
    } as unknown as ExecutionContext;

    let calls = 0;
    const next = {
      handle: () => {
        calls += 1;
        return of('ok');
      }
    };

    await firstValueFrom(interceptor.intercept(ctx, next as any));
    await firstValueFrom(interceptor.intercept(ctx, next as any));

    expect(calls).toBe(2); // 兩次都要執行
    expect(new Reflector().get(IDEMPOTENT_META_KEY, Plain.prototype.handle)).toBeUndefined();
  });
});
