import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { AuthTokenService } from '@/util/auth-token.service';
import { RealtimeService } from './realtime.service';
import type { AuthUser } from '@app-types/user-auth.type';
import { WS_CHANNEL, type ClientMessage, type ServerMessage, type WsChannel } from './ws.type';

/** 心跳間隔：比多數反向代理的 60 秒閒置逾時短，連線才不會被中間層默默切掉 */
const HEARTBEAT_MS = 25_000;

type Session = {
  socket: WebSocket;
  user: AuthUser;
  channels: Set<WsChannel>;
  /** 目前正在看的案件；同時是討論串的房間 */
  caseRoom?: number;
  alive: boolean;
};

/**
 * 即時通訊。
 *
 * 三個設計決定：
 *   1. 連線時就驗 Token —— WebSocket 沒有「每個請求帶一次憑證」的機制，
 *      握手是唯一能擋人的時機；驗過之後把身分綁在連線上。
 *   2. 依公司分房 + 頻道訂閱 —— 多租戶下絕不能把 A 公司的案件推給 B 公司；
 *      頻道則讓只開派工畫面的人不必收到全部案件流量。
 *   3. 應用層心跳 —— TCP 斷線在行動網路下經常無聲無息，
 *      沒有心跳的話伺服器會抱著一堆早就不存在的連線。
 */
@WebSocketGateway({ path: '/ws' })
export class CaseGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WebSocket');
  private readonly sessions = new Map<WebSocket, Session>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly realtimeService: RealtimeService
  ) {}

  async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // 瀏覽器的 WebSocket API 不能自訂表頭，所以 token 走 query；
    // cookie 也接受，讓同源的頁面不必把 token 撈出來
    const token = url.searchParams.get('token') ?? this.readCookie(req.headers.cookie, 'token');

    if (!token) {
      socket.close(4001, 'token required');
      return;
    }

    let user: AuthUser;
    try {
      user = await this.authTokenService.jwtVerify<AuthUser>(token);
    } catch {
      socket.close(4003, 'invalid token');
      return;
    }

    // 預設訂閱案件與線上狀態：幾乎每個畫面都要，其餘由前端自己加
    const session: Session = { socket, user, channels: new Set<WsChannel>(['case', 'presence']), alive: true };
    this.sessions.set(socket, session);

    socket.on('message', (raw: Buffer) => void this.handleMessage(session, raw));
    socket.on('pong', () => (session.alive = true));

    this.send(socket, {
      type: 'welcome',
      data: { uid: user.uid, account: user.account, companyId: user.companyId, channels: [...session.channels] }
    });
    await this.realtimeService.touchPresence(user);
    this.broadcast(user.companyId, 'presence.joined', { uid: user.uid, name: user.name });
    this.startHeartbeat();

    this.logger.log(`🔌 ${user.account} 連線(company=${user.companyId})，目前 ${this.sessions.size} 條`);
  }

  handleDisconnect(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    if (session) {
      void this.realtimeService.clearPresence(session.user);
      this.broadcast(session.user.companyId, 'presence.left', { uid: session.user.uid, name: session.user.name });
    }

    this.sessions.delete(socket);
    if (this.sessions.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  /**
   * 廣播給某公司訂閱了該頻道的連線。
   *
   * 事件從 Redis 事件匯流排進來(見 case-events.controller)，
   * 所以有幾個 api 實例都沒關係 —— 每個實例只推自己手上的連線。
   */
  public broadcast(companyId: number, type: `${WsChannel}.${string}`, data: unknown, exclude?: WebSocket): number {
    const channel = type.split('.')[0] as WsChannel;

    let sent = 0;
    for (const session of this.sessions.values()) {
      if (session.user.companyId !== companyId) continue;
      if (!session.channels.has(channel)) continue;
      if (exclude && session.socket === exclude) continue;

      this.send(session.socket, { type, data } as ServerMessage);
      sent += 1;
    }

    return sent;
  }

  /** 目前連線統計(維運用) */
  public getStats() {
    const byCompany = new Map<number, number>();
    for (const s of this.sessions.values()) byCompany.set(s.user.companyId, (byCompany.get(s.user.companyId) ?? 0) + 1);

    return { total: this.sessions.size, byCompany: Object.fromEntries(byCompany) };
  }

  // ─── 內部 ────────────────────────────────────────────────────────

  private async handleMessage(session: Session, raw: Buffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      this.send(session.socket, { type: 'error', data: { message: 'invalid json' } });
      return;
    }

    // 有任何互動就更新線上狀態：心跳只證明連線活著，不代表人還在看畫面
    void this.realtimeService.touchPresence(session.user, session.caseRoom);

    try {
      await this.route(session, msg);
    } catch (error: any) {
      this.send(session.socket, { type: 'error', data: { message: error?.message ?? '處理失敗' } });
    }
  }

  private async route(session: Session, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'subscribe': {
        for (const ch of msg.channels ?? []) if (WS_CHANNEL.includes(ch)) session.channels.add(ch);
        this.send(session.socket, { type: 'subscribed', data: { channels: [...session.channels] } });
        break;
      }
      case 'unsubscribe': {
        for (const ch of msg.channels ?? []) session.channels.delete(ch);
        this.send(session.socket, { type: 'subscribed', data: { channels: [...session.channels] } });
        break;
      }
      case 'ping':
        this.send(session.socket, { type: 'pong', data: { at: Date.now() } });
        break;

      // ─── 案件討論串 ──────────────────────────────────────────────
      case 'case.enter': {
        session.caseRoom = msg.caseId;
        // 進房就把最近的訊息補齊：斷線期間的對話不會消失
        const messages = await this.realtimeService.getRecentMessages(msg.caseId);
        this.send(session.socket, { type: 'chat.history', data: { caseId: msg.caseId, messages } });
        break;
      }

      case 'case.leave':
        if (session.caseRoom === msg.caseId) session.caseRoom = undefined;
        break;

      case 'chat.send': {
        const saved = await this.realtimeService.saveMessage(msg.caseId, session.user, msg.body);
        this.broadcastToCase(session.user.companyId, msg.caseId, 'chat.message', saved);
        break;
      }

      // ─── 位置回報 ────────────────────────────────────────────────
      case 'location.report': {
        const point = await this.realtimeService.reportLocation(session.user, {
          lng: msg.lng,
          lat: msg.lat,
          speedKph: msg.speedKph,
          heading: msg.heading
        });
        // 位置推給訂閱 fleet 的看板，不回推給回報者自己(他早就知道自己在哪)
        this.broadcast(session.user.companyId, 'fleet.moved', point, session.socket);
        break;
      }

      // ─── 編輯鎖 ──────────────────────────────────────────────────
      case 'lock.acquire': {
        const result = await this.realtimeService.acquireLock(session.user.companyId, msg.resource, session.user);
        this.send(session.socket, { type: 'lock.result', data: { resource: msg.resource, ...result } });
        if (result.granted)
          this.broadcast(session.user.companyId, 'lock.taken', { resource: msg.resource, holder: session.user.name });
        break;
      }

      case 'lock.release':
        await this.realtimeService.releaseLock(session.user.companyId, msg.resource, session.user);
        this.broadcast(session.user.companyId, 'lock.released', { resource: msg.resource });
        break;

      default:
        this.send(session.socket, { type: 'error', data: { message: 'unknown message type' } });
    }
  }

  /** 只推給正在看同一個案件的人 */
  private broadcastToCase(companyId: number, caseId: number, type: string, data: unknown): number {
    let sent = 0;
    for (const session of this.sessions.values()) {
      if (session.user.companyId !== companyId || session.caseRoom !== caseId) continue;
      this.send(session.socket, { type, data });
      sent += 1;
    }

    return sent;
  }

  /** 心跳：上一輪沒回 pong 的連線視為已死，直接砍掉 */
  private startHeartbeat(): void {
    if (this.heartbeat) return;

    this.heartbeat = setInterval(() => {
      for (const [socket, session] of this.sessions) {
        if (!session.alive) {
          socket.terminate();
          this.sessions.delete(socket);
          continue;
        }

        session.alive = false;
        socket.ping();
      }
    }, HEARTBEAT_MS);
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== 1) return; // 1 = OPEN
    socket.send(JSON.stringify(message));
  }

  private readCookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((s) => s.trim().split('='))
      .find(([k]) => k === name)?.[1];
  }
}
