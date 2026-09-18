import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { WebSocket } from 'ws';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { Vehicle } from '@/fleet/entities/vehicle.entity';
import type { CommandAction, CommandResult, DeviceSession, EcuSnapshot, ServerCommand, StreamState } from './vehicle-comm.type';

/** 車機狀態在 Redis 的存活時間：超過就視為離線 */
const SESSION_TTL_MS = 3 * 60_000;

/** 指令等待 ack 的上限；車機在行動網路下回應慢，但十秒還沒回就是沒收到 */
const COMMAND_TIMEOUT_MS = 10_000;

const sessionKey = (companyId: number, deviceId: string) => `devcomm:${companyId}:${deviceId}`;

/**
 * 車機通訊。
 *
 * 連線狀態放 **Redis 而不是資料表**：
 *   - 連線是暫時的，行程重啟時該忘掉的就該忘掉
 *   - 多個 api 實例要看到同一份狀態(看板問的是「現在哪幾台連著」)
 *   - 每則心跳都寫一次資料庫，十台車一天就是三萬次沒有價值的寫入
 *
 * 但 socket 本身只存在收到它的那個行程裡 —— 所以下指令時要先確認
 * 「這台車機連在我這個實例上嗎」，不在就回報無法下達。
 * 正式環境要跨實例下指令的話，這裡會需要一層訊息匯流排；
 * Demo 只跑一個 api 實例，先把邊界說清楚而不是假裝它不存在。
 */
@Injectable()
export class VehicleCommService {
  private readonly logger = new Logger('VehicleComm');

  /** 本行程持有的連線：deviceId → socket */
  private readonly sockets = new Map<string, WebSocket>();

  /** 等待 ack 的指令：commandId → resolve */
  private readonly pending = new Map<string, (result: CommandResult) => void>();

  constructor(
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    private readonly redisService: RedisService
  ) {}

  // ─── 連線生命週期 ──────────────────────────────────────────────

  /** 車機連上來；回傳這台車的資料，找不到就代表金鑰對但車機沒登錄 */
  public async attach(deviceId: string, companyId: number, socket: WebSocket): Promise<DeviceSession> {
    const vehicle = await this.vehicleRepo.findOne({ where: { deviceId, company: { id: companyId } } });
    if (!vehicle) throw new NotFoundException(`找不到車機：${deviceId}`);

    // 同一台車機重連時，舊連線先關掉 —— 車機在網路抖動後會重連，
    // 不關的話會累積一堆已經死掉的 socket，而指令會下到其中一條沒有人聽的
    const previous = this.sockets.get(deviceId);
    if (previous && previous !== socket) {
      this.logger.log(`🔌 ${deviceId} 重連，關閉舊連線`);
      try {
        previous.close(4000, 'replaced by new connection');
      } catch {
        // 舊連線可能已經半死，關不掉就算了
      }
    }

    this.sockets.set(deviceId, socket);

    const session: DeviceSession = {
      deviceId,
      vehicleId: vehicle.id,
      plateNo: vehicle.plateNo,
      companyId,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
      streamState: 'IDLE',
      frames: 0
    };

    await this.saveSession(session);
    await this.vehicleRepo.update({ id: vehicle.id }, { state: 'ONLINE' });

    return session;
  }

  /** 車機斷線 */
  public async detach(deviceId: string, companyId: number): Promise<void> {
    this.sockets.delete(deviceId);
    await this.redisService.del(sessionKey(companyId, deviceId));

    const vehicle = await this.vehicleRepo.findOne({ where: { deviceId, company: { id: companyId } } });
    // 只把 ONLINE 改成 OFFLINE：停用中的車不該因為斷線就變成離線
    if (vehicle && vehicle.state === 'ONLINE') {
      await this.vehicleRepo.update({ id: vehicle.id }, { state: 'OFFLINE' });
    }
  }

  /**
   * 更新狀態；心跳、ECU、串流狀態都走這裡。
   *
   * **只寫有改的欄位**，不是讀出整包再寫回 —— 車機會同時送 ECU 與影像幀，
   * 兩邊各自讀改寫的話，後寫的會把前一方的改動蓋掉，而那不會報錯，
   * 只是 ECU 欄位安靜地變成 null。
   */
  public async touch(
    deviceId: string,
    companyId: number,
    patch: Partial<Pick<DeviceSession, 'ecu' | 'streamState' | 'streamUrl'>> = {}
  ): Promise<void> {
    await this.redisService.hsetJson(
      sessionKey(companyId, deviceId),
      { ...patch, lastSeenAt: Date.now() },
      SESSION_TTL_MS
    );
  }

  /**
   * 收到一張影像幀：只累加計數，不存內容 —— Demo 不做錄影。
   *
   * 用 `HINCRBY` 而不是讀出來加一再寫回：串流每秒幾十幀，
   * 讀改寫會讓計數在併發下少算，而「幀數有沒有在動」正是判斷
   * 串流是不是卡住的依據。
   */
  public async countFrame(deviceId: string, companyId: number): Promise<void> {
    const key = sessionKey(companyId, deviceId);
    await this.redisService.hincr(key, 'frames', 1, SESSION_TTL_MS);
    await this.redisService.hsetJson(key, { lastSeenAt: Date.now() }, SESSION_TTL_MS);
  }

  /** 車機回報指令執行結果 */
  public resolveAck(commandId: string, ok: boolean, message?: string): void {
    const resolve = this.pending.get(commandId);
    if (!resolve) return; // 已經逾時了，車機的回應來晚了

    this.pending.delete(commandId);
    resolve({ commandId, ok, message });
  }

  // ─── 對外查詢與指令 ────────────────────────────────────────────

  /** 目前連線中的車機 */
  public async listSessions(companyId: number): Promise<HttpResult> {
    const sessions = await this.scanSessions(companyId);
    const now = Date.now();

    return HttpResponse.successOrWarn({
      data: sessions
        .map((s) => ({
          DEVICE_ID: s.deviceId,
          PLATE_NO: s.plateNo,
          VEHICLE_ID: s.vehicleId,
          CONNECTED_AT: new Date(s.connectedAt),
          LAST_SEEN_AT: new Date(s.lastSeenAt),
          SILENT_SEC: Math.round((now - s.lastSeenAt) / 1000),
          STREAM_STATE: s.streamState,
          STREAM_URL: s.streamUrl ?? null,
          FRAMES: s.frames,
          ECU: s.ecu ?? null,
          // 這台車機連在哪個 api 實例上；不在本實例就下不了指令
          CONTROLLABLE: this.sockets.has(s.deviceId)
        }))
        .sort((a, b) => a.PLATE_NO.localeCompare(b.PLATE_NO)),
      warnMsg: '目前沒有車機連線'
    });
  }

  /**
   * 下指令給車機並等待 ack。
   *
   * 等 ack 而不是送出就算：「開始串流」這種指令，沒有回應等於不知道成功了沒有，
   * 而畫面上會顯示成已開始 —— 使用者會一直等一個永遠不會來的影像。
   *
   * 逾時回報為失敗而不是丟例外：指令沒送到是**業務結果**而不是系統錯誤。
   */
  public async sendCommand(
    companyId: number,
    deviceId: string,
    action: CommandAction,
    payload?: Record<string, unknown>
  ): Promise<HttpResult> {
    const session = await this.getSession(companyId, deviceId);
    if (!session) throw new NotFoundException(`車機未連線：${deviceId}`);

    const socket = this.sockets.get(deviceId);
    if (!socket || socket.readyState !== 1) {
      throw new BadRequestException(`車機連線不在本服務實例上，無法下達指令：${deviceId}`);
    }

    const commandId = randomUUID();
    const command: ServerCommand = { type: 'command', commandId, action, payload };

    const result = await new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ commandId, ok: false, timedOut: true, message: '車機未在時限內回應' });
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(commandId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });

      socket.send(JSON.stringify(command));
    });

    this.logger.log(`📡 ${deviceId} ← ${action}：${result.ok ? '成功' : result.message}`);

    return HttpResponse.successOrWarn({
      data: { COMMAND_ID: result.commandId, ACTION: action, OK: result.ok, TIMED_OUT: !!result.timedOut },
      okMsg: `指令 ${action} 已執行`,
      warnMsg: `指令 ${action} 未成功：${result.message ?? '未知原因'}`,
      isEmpty: () => !result.ok
    });
  }

  // ─── 內部 ──────────────────────────────────────────────────────

  private async saveSession(session: DeviceSession): Promise<void> {
    await this.redisService.hsetJson(
      sessionKey(session.companyId, session.deviceId),
      session as unknown as Record<string, unknown>,
      SESSION_TTL_MS
    );
  }

  public async getSession(companyId: number, deviceId: string): Promise<DeviceSession | null> {
    return await this.redisService.hgetJson<DeviceSession>(sessionKey(companyId, deviceId));
  }

  /**
   * 掃出這間公司的所有車機狀態。
   *
   * 用 `SCAN` 而不是 `KEYS`：後者在鍵數量大時會阻塞整個 Redis，
   * 而這是所有服務共用的同一台。
   */
  private async scanSessions(companyId: number): Promise<DeviceSession[]> {
    const prefix = `devcomm:${companyId}:`;
    const result: DeviceSession[] = [];
    let cursor = '0';

    try {
      do {
        const [next, keys] = await this.redisService.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;

        for (const key of keys) {
          const value = await this.redisService.hgetJson<DeviceSession>(key);
          if (value) result.push(value);
        }
      } while (cursor !== '0');
    } catch (error: any) {
      // Redis 不可用時回空清單而不是讓整個查詢失敗：
      // 「看不到車機狀態」比「車隊管理整頁壞掉」好
      this.logger.warn(`車機狀態掃描失敗：${error?.message}`);
    }

    return result;
  }

  /** 串流狀態的中文；下指令的回應與看板共用同一份說法 */
  public static streamLabel(state: StreamState): string {
    return { IDLE: '待機', STARTING: '啟動中', STREAMING: '串流中', ERROR: '異常' }[state] ?? state;
  }

  /**
   * 給模擬器用：直接寫入一筆車機狀態，不經過 WebSocket。
   *
   * 刻意與 `attach` 分開：`attach` 會把 socket 記進本行程的連線表，
   * 而模擬出來的車機沒有 socket —— 混用的話，下指令時會找到一個
   * 不存在的連線然後永遠等不到 ack。
   */
  public async attachSimulated(input: {
    deviceId: string;
    vehicleId: number;
    plateNo: string;
    companyId: number;
    streamState: StreamState;
    ecu: EcuSnapshot;
  }): Promise<void> {
    await this.saveSession({
      ...input,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
      frames: 0
    });

    await this.vehicleRepo.update({ id: input.vehicleId }, { state: 'ONLINE' });
  }
}
