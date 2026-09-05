import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '@/redis/redis.service';
import { CaseMessage } from './entities/case-message.entity';
import type { AuthUser } from '@app-types/user-auth.type';

const PRESENCE_TTL_MS = 60_000;
const LOCATION_TTL_MS = 120_000;
const LOCK_TTL_MS = 120_000;

export type FleetPoint = { uid: number; name: string; lng: number; lat: number; speedKph?: number; heading?: number; at: number };

/**
 * 即時互動的狀態層。
 *
 * 三種資料放三個地方，依「壞掉時損失什麼」決定：
 *   訊息  → PostgreSQL  斷線要補得回來，是紀錄的一部分
 *   位置  → Redis(TTL)  只有「現在」有價值，重啟後重新回報就好
 *   鎖    → Redis(TTL)  過期自動釋放，才不會有人關掉分頁就把單卡住
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('Realtime');

  constructor(
    @InjectRepository(CaseMessage) private readonly messageRepo: Repository<CaseMessage>,
    private readonly redisService: RedisService
  ) {}

  // ─── 案件討論 ───────────────────────────────────────────────────

  /** 儲存並回傳一則訊息 */
  public async saveMessage(caseId: number, user: AuthUser, body: string) {
    const trimmed = body.trim().slice(0, 500);
    if (!trimmed) throw new Error('訊息不可為空');

    const saved = await this.messageRepo.save(
      this.messageRepo.create({ patrolCase: { id: caseId }, sender: { id: user.uid }, body: trimmed })
    );

    return { ID: saved.id, CASE_ID: caseId, SENDER: user.name, SENDER_UID: user.uid, BODY: trimmed, CREATED_AT: saved.createdAt };
  }

  /** 取最近的訊息(進入討論串時回補) */
  public async getRecentMessages(caseId: number, limit = 50) {
    const rows = await this.messageRepo.find({
      where: { patrolCase: { id: caseId } },
      relations: { sender: true },
      order: { id: 'DESC' },
      take: limit
    });

    return rows
      .reverse() // 查詢用倒序取最新，回傳前轉正序，前端不必再排一次
      .map((m) => ({ ID: m.id, CASE_ID: caseId, SENDER: m.sender?.name ?? '(已刪除)', SENDER_UID: m.sender?.id ?? null, BODY: m.body, CREATED_AT: m.createdAt }));
  }

  // ─── 線上狀態 ───────────────────────────────────────────────────

  /**
   * 更新線上狀態。
   * 用 TTL 而不是「連線時寫入、斷線時刪除」：行程被強制結束時不會有斷線事件，
   * 那些殘留的狀態會讓派工的人以為師傅在線上。
   */
  public async touchPresence(user: AuthUser, viewingCaseId?: number): Promise<void> {
    await this.redisService.setJson(
      `presence:${user.companyId}:${user.uid}`,
      { uid: user.uid, name: user.name, account: user.account, viewingCaseId: viewingCaseId ?? null, at: Date.now() },
      PRESENCE_TTL_MS
    );
  }

  public async clearPresence(user: AuthUser): Promise<void> {
    await this.redisService.del(`presence:${user.companyId}:${user.uid}`);
  }

  /** 目前在線的人 */
  public async listPresence(companyId: number) {
    return await this.scanJson(`presence:${companyId}:*`);
  }

  // ─── 位置回報 ───────────────────────────────────────────────────

  public async reportLocation(user: AuthUser, point: Omit<FleetPoint, 'uid' | 'name' | 'at'>): Promise<FleetPoint> {
    const value: FleetPoint = { uid: user.uid, name: user.name, ...point, at: Date.now() };
    await this.redisService.setJson(`fleet:${user.companyId}:${user.uid}`, value, LOCATION_TTL_MS);

    return value;
  }

  /** 目前在跑的車輛/人員位置 */
  public async listFleet(companyId: number): Promise<FleetPoint[]> {
    return (await this.scanJson(`fleet:${companyId}:*`)) as FleetPoint[];
  }

  // ─── 編輯鎖 ─────────────────────────────────────────────────────

  /**
   * 取得編輯鎖。
   * 這是「提醒」而不是強制：後端仍然以資料庫約束為準 ——
   * 前端鎖只是讓兩個人不要同時打字，不能拿來當正確性的保證。
   */
  public async acquireLock(companyId: number, resource: string, user: AuthUser): Promise<{ granted: boolean; holder?: string }> {
    const key = `editlock:${companyId}:${resource}`;
    const granted = await this.redisService.acquire(key, LOCK_TTL_MS, JSON.stringify({ uid: user.uid, name: user.name }));

    if (granted) return { granted: true };

    const holder = await this.redisService.getJson<{ uid: number; name: string }>(key);
    // 同一個人重新開啟頁面時應該拿得回自己的鎖，而不是被自己擋住
    if (holder?.uid === user.uid) {
      await this.redisService.setJson(key, holder, LOCK_TTL_MS);
      return { granted: true };
    }

    return { granted: false, holder: holder?.name };
  }

  public async releaseLock(companyId: number, resource: string, user: AuthUser): Promise<void> {
    const key = `editlock:${companyId}:${resource}`;
    const holder = await this.redisService.getJson<{ uid: number }>(key);
    if (holder?.uid === user.uid) await this.redisService.del(key);
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /** 用 SCAN 而不是 KEYS：KEYS 在鍵多的時候會把 Redis 卡住 */
  private async scanJson(pattern: string): Promise<unknown[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [next, found] = await this.redisService.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');

    if (!keys.length) return [];

    const values = await this.redisService.client.mget(...keys);
    return values.filter((v): v is string => !!v).map((v) => JSON.parse(v));
  }
}
