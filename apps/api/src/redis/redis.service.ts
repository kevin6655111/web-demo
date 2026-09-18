import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '@/env/env.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * 應用層的 Redis 連線（快取、冪等鍵、分散式鎖、線上狀態）。
 *
 * BullMQ 有自己的連線設定，不共用這一條 —— 兩者對「連不上時該怎麼辦」的要求相反：
 * 佇列必須無限重試直到連上，否則工作會遺失；應用層則必須快速失敗，
 * 因為使用者正在等待回應。
 *
 * 三個設定合起來決定了失敗模式：
 *
 * - `enableOfflineQueue: false` —— 斷線時命令**立刻拋錯**而不是排隊等待。
 *   預設值會讓命令無限期排隊，於是 Redis 掛掉時請求不是失敗，而是**卡住**，
 *   連呼叫端的 try/catch 都等不到。整站沒有回應遠比功能降級嚴重。
 * - `maxRetriesPerRequest: 2` —— 短暫抖動仍會重試，但有上限。
 * - `commandTimeout` —— 連得上但沒有回應時（Redis 正在做大量工作）也要有上界。
 */
export const redisClientProvider = {
  provide: REDIS_CLIENT,
  inject: [EnvService],
  useFactory: (envService: EnvService): Redis => {
    const { host, port } = envService.getRedisConfig();

    const client = new Redis({
      host,
      port,
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      commandTimeout: 1000
    });

    // 沒有這個處理器，ioredis 的連線錯誤會變成未捕捉的例外並讓行程結束
    client.on('error', (error) => new Logger('Redis').warn(`連線異常：${error?.message}`));

    return client;
  }
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  public get client(): Redis {
    return this.redis;
  }

  /**
   * 搶佔一把鎖：搶到回 true，已經有人佔著回 false。
   * 用 SET NX PX 一次完成「檢查 + 設定」，避免 GET 後再 SET 的競態。
   */
  public async acquire(key: string, ttlMs: number, value = '1'): Promise<boolean> {
    const res = await this.redis.set(key, value, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  public async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  public async setJson(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
  }

  public async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  public async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * 讀快取；沒有就計算、存起來再回傳。
   *
   * **快取失效不能讓功能失效**：Redis 連不上時直接回退到計算，
   * 僅記錄警告。快取是為了省成本，不是正確性的一環 ——
   * 讓它成為單點故障，等於用一個可選的元件換掉整個服務的可用性。
   *
   * @param key     快取鍵；請帶上公司代碼，多租戶的資料不能互相看到
   * @param ttlMs   存活時間
   * @param compute 快取未命中時的計算函式
   */
  public async remember<T>(
    key: string,
    ttlMs: number,
    compute: () => Promise<T>
  ): Promise<{ value: T; cached: boolean }> {
    try {
      const hit = await this.getJson<T>(key);
      if (hit !== null) return { value: hit, cached: true };
    } catch (error: any) {
      this.logger.warn(`快取讀取失敗，改為即時計算(${key}): ${error?.message}`);
      return { value: await compute(), cached: false };
    }

    const value = await compute();

    // 寫入失敗不影響這次的回應 —— 資料已經算出來了
    try {
      await this.setJson(key, value, ttlMs);
    } catch (error: any) {
      this.logger.warn(`快取寫入失敗(${key}): ${error?.message}`);
    }

    return { value, cached: false };
  }

  /**
   * 設定 hash 的部分欄位並續期。
   *
   * 用 hash 而不是整包 JSON，是為了避開**遺失更新**：
   * 「讀出整包 → 改一個欄位 → 寫回」在兩個來源同時更新時，
   * 後寫的那一方會把前一方的改動蓋掉 —— 而那不會報錯，
   * 只是某個欄位安靜地消失。車機同時送 ECU 與影像幀就會撞到這件事。
   *
   * 值一律序列化成字串：Redis 的 hash 只存字串，而物件欄位要能存 JSON。
   */
  public async hsetJson(key: string, fields: Record<string, unknown>, ttlMs: number): Promise<void> {
    const flat: string[] = [];
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      flat.push(field, typeof value === 'string' ? value : JSON.stringify(value));
    }
    if (!flat.length) return;

    await this.redis.hset(key, ...flat);
    await this.redis.pexpire(key, ttlMs);
  }

  /** 原子遞增 hash 的某個數字欄位；計數器不能用讀改寫 */
  public async hincr(key: string, field: string, by = 1, ttlMs?: number): Promise<number> {
    const value = await this.redis.hincrby(key, field, by);
    if (ttlMs) await this.redis.pexpire(key, ttlMs);

    return value;
  }

  /** 讀回整個 hash；欄位值以 JSON 解析，解不開就當字串 */
  public async hgetJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.hgetall(key);
    if (!raw || !Object.keys(raw).length) return null;

    const parsed: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(raw)) {
      try {
        parsed[field] = JSON.parse(value);
      } catch {
        parsed[field] = value;
      }
    }

    return parsed as T;
  }

  /**
   * 依前綴清除。
   *
   * 用 `SCAN` 而不是 `KEYS`：後者在鍵數量大時會阻塞整個 Redis，
   * 而這是所有服務共用的同一台。
   *
   * @returns 實際刪除的鍵數
   */
  public async delByPrefix(prefix: string): Promise<number> {
    let cursor = '0';
    let removed = 0;

    try {
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;

        if (keys.length) {
          await this.redis.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== '0');
    } catch (error: any) {
      // 清不掉的下場是短暫看到舊資料，而 TTL 仍會讓它過期
      this.logger.warn(`快取清除失敗(${prefix}*): ${error?.message}`);
    }

    return removed;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
