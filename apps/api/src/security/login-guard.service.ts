import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const WINDOW_MS = 15 * 60_000;

/**
 * 登入失敗鎖定。
 *
 * 全域流量限制擋的是「同一個 IP 打太快」，但密碼噴灑攻擊會用大量 IP、
 * 對同一個帳號慢慢試 —— 那種攻擊只有按帳號計數才擋得住，所以兩層都要。
 *
 * 鎖定與計數都放 Redis：多個 api 實例要看到同一份計數，
 * 而且重啟時該忘掉的就忘掉(這是暫時性資料，不該進資料庫)。
 *
 * **Redis 無法存取時採取「失敗放行」**：計數與鎖定失效，登入照常進行。
 *
 * 反向的選擇（失敗擋下）會讓 Redis 故障直接等同於全站無法登入 ——
 * 以一個可選元件的故障換掉整個系統的可用性。而放行的風險是有界的：
 * 全域流量限制仍然生效，且 Redis 故障屬於分鐘級的維運事件。
 *
 * 每次降級都會留下警告日誌，因為「保護機制何時失效過」必須查得到。
 */
@Injectable()
export class LoginGuardService {
  private readonly logger = new Logger('LoginGuard');

  constructor(private readonly redisService: RedisService) {}

  /** 是否已鎖定；回傳剩餘秒數。Redis 不可用時回 0（未鎖定）*/
  public async getLockRemainSec(companyKey: string, account: string): Promise<number> {
    try {
      const ttl = await this.redisService.client.pttl(this.lockKey(companyKey, account));
      return ttl > 0 ? Math.ceil(ttl / 1000) : 0;
    } catch (error: any) {
      this.degraded('查詢鎖定狀態', error);
      return 0;
    }
  }

  /** 記一次失敗；達到門檻就鎖定 */
  public async recordFailure(companyKey: string, account: string): Promise<{ locked: boolean; remaining: number }> {
    const key = this.failKey(companyKey, account);

    try {
      const count = await this.redisService.client.incr(key);
      // 只有第一次要設過期時間，否則每次失敗都會把視窗往後推，等於永遠不過期
      if (count === 1) await this.redisService.client.pexpire(key, WINDOW_MS);

      if (count >= MAX_FAILURES) {
        await this.redisService.client.set(this.lockKey(companyKey, account), '1', 'PX', LOCK_MS);
        await this.redisService.del(key);
        this.logger.warn(`🔒 帳號鎖定 ${companyKey}/${account}(連續失敗 ${count} 次)`);

        return { locked: true, remaining: 0 };
      }

      return { locked: false, remaining: MAX_FAILURES - count };
    } catch (error: any) {
      this.degraded('記錄登入失敗', error);
      return { locked: false, remaining: MAX_FAILURES };
    }
  }

  /** 登入成功：清掉計數 */
  public async clear(companyKey: string, account: string): Promise<void> {
    try {
      await this.redisService.del(this.failKey(companyKey, account));
      await this.redisService.del(this.lockKey(companyKey, account));
    } catch (error: any) {
      // 清不掉的下場是計數仍在，但它本來就有存活時間
      this.degraded('清除登入計數', error);
    }
  }

  /** 降級一律留下警告：保護機制何時失效過，是事後一定會被追問的問題 */
  private degraded(action: string, error: unknown): void {
    this.logger.warn(`⚠️  ${action}失敗，登入失敗鎖定暫時失效：${(error as Error)?.message}`);
  }

  private failKey(companyKey: string, account: string): string {
    return `login:fail:${companyKey}:${account}`;
  }

  private lockKey(companyKey: string, account: string): string {
    return `login:lock:${companyKey}:${account}`;
  }
}
