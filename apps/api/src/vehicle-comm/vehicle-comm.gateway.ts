import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { ApiKeyService } from '@/auth/api-key.service';
import { ACTION } from '@constants/module.const';
import { VehicleCommService } from './vehicle-comm.service';
import type { DeviceMessage, ServerCommand } from './vehicle-comm.type';

/** 心跳間隔：比多數行動網路的閒置逾時短，連線才不會被中間層默默切掉 */
const HEARTBEAT_MS = 30_000;

type DeviceContext = { deviceId: string; companyId: number };

/**
 * 車機的 WebSocket 連線。
 *
 * 與前端的 `/ws` 分開成兩個 gateway，理由是**信任邊界不同**：
 * 前端連線帶使用者 JWT、可以訂閱全公司的案件；
 * 車機帶設備金鑰、只能回報自己的狀態。混在一起的話，
 * 權限判斷會變成每一則訊息都要問一次「你是誰、你能做什麼」。
 *
 * 三個設計決定：
 *
 * 1. **握手時驗金鑰**：WebSocket 沒有「每個訊息帶一次憑證」的機制，
 *    握手是唯一能擋人的時機。金鑰要有 `TRACK.CREATE` 權限 ——
 *    純讀取的金鑰不該連得上車機通道。
 *
 * 2. **二進位當影像幀**：影像不走 JSON。Demo 只計數不存內容，
 *    但協定上分得開，換成真的錄影時不必改車機那一端。
 *
 * 3. **應用層心跳**：行動網路斷線經常無聲無息，沒有心跳的話
 *    伺服器會抱著一堆早就不存在的連線，而指令會下到沒有人聽的那一條。
 */
@WebSocketGateway({ path: '/ws/device' })
export class VehicleCommGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('DeviceWS');
  private readonly contexts = new Map<WebSocket, DeviceContext>();
  private readonly alive = new Map<WebSocket, boolean>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly vehicleCommService: VehicleCommService
  ) {}

  async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // 車機不是瀏覽器，可以帶表頭；但 query 也接受，方便用工具測試
    const key = (req.headers['x-api-key'] as string) ?? url.searchParams.get('key') ?? '';
    const deviceId = url.searchParams.get('device') ?? '';

    if (!key || !deviceId) {
      socket.close(4001, 'device and key required');
      return;
    }

    let companyId: number;
    try {
      const identity = await this.apiKeyService.authenticate(key);
      // 純讀取的金鑰不該連得上車機通道：能連就能送 ECU 與影像
      if (!identity.actions.includes(ACTION.TRACK.CREATE)) {
        socket.close(4003, 'key lacks TRACK.CREATE');
        return;
      }
      companyId = identity.companyId;
    } catch {
      socket.close(4003, 'invalid api key');
      return;
    }

    try {
      const session = await this.vehicleCommService.attach(deviceId, companyId, socket);
      this.contexts.set(socket, { deviceId, companyId });
      this.alive.set(socket, true);

      this.send(socket, {
        type: 'welcome',
        data: { deviceId, plateNo: session.plateNo, serverTime: Date.now() }
      });

      socket.on('message', (raw: Buffer, isBinary?: boolean) => void this.handleMessage(socket, raw, isBinary));
      socket.on('pong', () => this.alive.set(socket, true));

      this.startHeartbeat();
      this.logger.log(`🚚 ${deviceId}(${session.plateNo}) 已連線，目前 ${this.contexts.size} 台`);
    } catch (error: any) {
      this.logger.warn(`🚚 ${deviceId} 連線被拒：${error?.message}`);
      socket.close(4004, error?.message ?? 'device not registered');
    }
  }

  handleDisconnect(socket: WebSocket): void {
    const ctx = this.contexts.get(socket);
    this.contexts.delete(socket);
    this.alive.delete(socket);

    if (ctx) {
      void this.vehicleCommService.detach(ctx.deviceId, ctx.companyId);
      this.logger.log(`🚚 ${ctx.deviceId} 已離線，剩 ${this.contexts.size} 台`);
    }

    if (!this.contexts.size && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private async handleMessage(socket: WebSocket, raw: Buffer, isBinary?: boolean): Promise<void> {
    const ctx = this.contexts.get(socket);
    if (!ctx) return;

    // 二進位是影像幀：不解析內容，只計數
    if (isBinary) {
      await this.vehicleCommService.countFrame(ctx.deviceId, ctx.companyId);
      return;
    }

    let msg: DeviceMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      this.send(socket, { type: 'error', data: { message: 'invalid json' } });
      return;
    }

    switch (msg.type) {
      case 'heartbeat':
        await this.vehicleCommService.touch(ctx.deviceId, ctx.companyId);
        break;

      case 'ecu':
        await this.vehicleCommService.touch(ctx.deviceId, ctx.companyId, { ecu: msg.data });
        break;

      case 'stream':
        await this.vehicleCommService.touch(ctx.deviceId, ctx.companyId, {
          streamState: msg.state,
          streamUrl: msg.url
        });
        break;

      case 'ack':
        this.vehicleCommService.resolveAck(msg.commandId, msg.ok, msg.message);
        break;

      default:
        this.send(socket, { type: 'error', data: { message: 'unknown message type' } });
    }
  }

  /** 心跳：上一輪沒回 pong 的連線視為已死，直接砍掉 */
  private startHeartbeat(): void {
    if (this.heartbeat) return;

    this.heartbeat = setInterval(() => {
      for (const [socket] of this.contexts) {
        if (!this.alive.get(socket)) {
          socket.terminate();
          this.handleDisconnect(socket);
          continue;
        }

        this.alive.set(socket, false);
        socket.ping();
      }
    }, HEARTBEAT_MS);
  }

  private send(socket: WebSocket, message: ServerCommand): void {
    if (socket.readyState !== 1) return; // 1 = OPEN
    socket.send(JSON.stringify(message));
  }
}
