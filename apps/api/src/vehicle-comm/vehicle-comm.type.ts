import {
  COMMAND_ACTION_DEF,
  STREAM_STATE_DEF,
  type CommandActionKey,
  type StreamStateKey
} from '@road-patrol/shared';

/**
 * 車機通訊協定。
 *
 * 與前端的 WebSocket(`/ws`)是**兩條不同的連線**，理由不是技術而是信任邊界：
 * 前端連線帶的是使用者的 JWT，車機帶的是設備金鑰；
 * 前端可以訂閱全公司的案件，車機只能回報自己的狀態。
 * 混在同一個 gateway 裡，權限判斷會變成每一則訊息都要問一次「你是誰」。
 */

/** 車機 → 伺服器 */
export type DeviceMessage =
  /** 心跳；帶上目前狀態讓伺服器不必另外問 */
  | { type: 'heartbeat'; at?: number }
  /** 車輛狀態回報(ECU)：電壓、轉速、里程表、故障碼 */
  | { type: 'ecu'; data: EcuSnapshot }
  /** 串流狀態變更的回報 */
  | { type: 'stream'; state: StreamState; url?: string }
  /** 對伺服器指令的回應 */
  | { type: 'ack'; commandId: string; ok: boolean; message?: string };

/** 伺服器 → 車機 */
export type ServerCommand =
  | { type: 'command'; commandId: string; action: CommandAction; payload?: Record<string, unknown> }
  | { type: 'welcome'; data: { deviceId: string; plateNo: string; serverTime: number } }
  | { type: 'error'; data: { message: string } };

/**
 * 可以下給車機的指令與串流狀態，**都從共用套件推導**。
 *
 * 在這裡再抄一份的下場已經在別的代碼表上發生過三次：
 * 後端加了一個指令、前端的按鈕列沒有它，而那不會報錯，
 * 只是那個指令永遠按不到。清單只能有一份。
 */
export const COMMAND_ACTIONS = COMMAND_ACTION_DEF.map((d) => d.key);
export type CommandAction = CommandActionKey;

export const STREAM_STATES = STREAM_STATE_DEF.map((d) => d.key);
export type StreamState = StreamStateKey;

/**
 * ECU 快照。
 *
 * 這些欄位是「車子現在怎麼樣」而不是「車子在哪裡」——
 * 位置走軌跡那條路徑(高頻、要落地)，狀態走這裡(低頻、只留最新)。
 */
export type EcuSnapshot = {
  /** 電瓶電壓；低於 12V 表示車子熄火或電瓶快沒電了 */
  voltageV?: number;
  rpm?: number;
  /** 儀表板里程(km)；與軌跡算出來的里程對照可以看出車機有沒有漏傳 */
  odometerKm?: number;
  coolantC?: number;
  fuelPercent?: number;
  /** 故障碼；有值就代表車子需要進廠 */
  faultCodes?: string[];
};

/** 一台車機的即時狀態；存在 Redis，不落地 */
export type DeviceSession = {
  deviceId: string;
  vehicleId: number;
  plateNo: string;
  companyId: number;
  connectedAt: number;
  lastSeenAt: number;
  streamState: StreamState;
  streamUrl?: string;
  ecu?: EcuSnapshot;
  /** 收到的影像幀數；用來判斷串流是不是真的在動 */
  frames: number;
};

/** 指令的等待結果 */
export type CommandResult = { commandId: string; ok: boolean; message?: string; timedOut?: boolean };
