import { Injectable } from '@nestjs/common';
import { config } from '@/env.bootstrap';
import type { AppConfig, DbCredentials } from './types/env.type';

/** 全系統唯一讀設定的入口：其他模組不直接碰 process.env 或 yaml */
@Injectable()
export class EnvService {
  /** 取得目前環境 */
  public getNodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  }

  /** 取得全部設定 */
  public getConfig(): AppConfig {
    return config;
  }

  /** 取得程式設定 */
  public getAppConfig(): AppConfig['app'] {
    return config.app;
  }

  /**
   * 取得本系統網址
   * 正式環境由根目錄 .env 的 DOMAIN 決定(docker-compose 傳入)，開發環境固定為本機
   */
  public getDomain(): string {
    const domain = this.getNodeEnv() === 'production' ? process.env.DOMAIN : undefined;
    if (domain) return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
    return 'http://localhost:3005';
  }

  /** 取得目前啟用的資料庫設定 */
  public getDatabaseEnv(): DbCredentials & { vendor: AppConfig['database']['vendor'] } {
    const { vendor } = config.database;
    return { vendor, ...config.database[vendor] };
  }

  /** 取得 Redis 設定 */
  public getRedisConfig(): AppConfig['redis'] {
    return config.redis;
  }

  /** 取得儲存後端類型 */
  public getStorageBackend(): AppConfig['storage']['backend'] {
    return config.storage.backend;
  }

  /** 取得 MinIO 設定(backend 為 MINIO 時才會有) */
  public getMinioConfig(): NonNullable<AppConfig['storage']['minio']> {
    const minio = config.storage.minio;
    if (!minio) throw new Error('config 缺少 storage.minio');
    return minio;
  }

  /** 取得 JWT 秘鑰 */
  public getJwtSecret(): string {
    return config.app.jwt.secret;
  }

  /** 取得憑證有效秒數 */
  public getTokenExpirationSec(): number {
    return config.app.jwt.expiresInSec ?? 1800;
  }

  /** 是否啟用排程 */
  public isTaskActive(): boolean {
    return !!config.task.active;
  }

  /** 取得排程設定 */
  public getTaskSchedule(): AppConfig['task']['schedule'] {
    return config.task.schedule;
  }
}
