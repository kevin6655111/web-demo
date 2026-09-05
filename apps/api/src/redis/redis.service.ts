import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '@/env/env.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** 建立 ioredis 連線的 provider(佇列與冪等性共用同一台 Redis，不同 key 前綴) */
export const redisClientProvider = {
  provide: REDIS_CLIENT,
  inject: [EnvService],
  useFactory: (envService: EnvService): Redis => {
    const { host, port } = envService.getRedisConfig();
    return new Redis({ host, port, maxRetriesPerRequest: null, enableReadyCheck: false });
  }
};

@Injectable()
export class RedisService implements OnModuleDestroy {
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

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
