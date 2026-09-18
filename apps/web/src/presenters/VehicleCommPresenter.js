import { COMMAND_ACTION_DANGER, COMMAND_ACTION_HINT, COMMAND_ACTION_LABEL, STREAM_STATE_COLOR, STREAM_STATE_LABEL } from '../config/vocabulary';

/**
 * 車機通訊的判斷邏輯。
 *
 * 這一頁上幾乎每個數字都需要翻譯才有意義：`SILENT_SEC` 是秒數，
 * 但督導要的是「這台是不是掉線了」；`voltageV` 是電壓，
 * 但要的是「這台車是不是熄火了」。翻譯就是判斷，所以在這裡而不是元件裡。
 */

/** 超過這個秒數沒有心跳就當作可能斷線；車機的心跳是 30 秒一次 */
const SILENT_WARN_SEC = 90;
/** 熄火判定：發動中的車電壓在 13.5V 以上(發電機在充電)，熄火後掉到 12V 附近 */
const ENGINE_OFF_VOLT = 12.8;

export const VehicleCommPresenter = {
  /** 一台車機的顯示屬性 */
  session(s) {
    const silent = s.SILENT_SEC >= SILENT_WARN_SEC;
    const ecu = s.ECU ?? {};
    const faults = ecu.faultCodes ?? [];

    return {
      ...s,
      streamLabel: STREAM_STATE_LABEL[s.STREAM_STATE] ?? s.STREAM_STATE,
      streamColor: STREAM_STATE_COLOR[s.STREAM_STATE],
      silent,
      // 「靜默 12 秒」不是資訊，「靜默 3 分鐘」才是。所以只在超標時說
      silentText: silent ? `已 ${Math.round(s.SILENT_SEC / 60)} 分鐘沒有心跳` : null,
      engineOff: ecu.voltageV !== undefined && ecu.voltageV < ENGINE_OFF_VOLT,
      faults,
      // 串流狀態說「串流中」但幀數沒有在增加，代表推流其實卡住了
      streamStalled: s.STREAM_STATE === 'STREAMING' && !s.FRAMES,
      verdict: VehicleCommPresenter.verdict(s, { silent, faults })
    };
  },

  /**
   * 一句話的結論。
   *
   * 排序就是處理的優先序：**車子本身的問題**排在通訊問題前面 ——
   * 一台有故障碼的車要進廠，而那比它的串流有沒有卡住重要得多。
   */
  verdict(s, { silent, faults }) {
    if (faults.length) return { text: `故障碼 ${faults.join('、')}`, level: 'error' };
    if (silent) return { text: '心跳逾時，可能已離線', level: 'warning' };
    if (!s.CONTROLLABLE) return { text: '連在別的節點，這裡下不了指令', level: 'warning' };
    if (s.STREAM_STATE === 'ERROR') return { text: '串流失敗', level: 'warning' };

    return { text: '正常', level: 'success' };
  },

  /** 指令按鈕；危險的排最後，並且要再確認一次 */
  commands() {
    return Object.keys(COMMAND_ACTION_LABEL)
      .map((key) => ({
        key,
        label: COMMAND_ACTION_LABEL[key],
        hint: COMMAND_ACTION_HINT[key],
        danger: COMMAND_ACTION_DANGER.includes(key)
      }))
      .sort((a, b) => Number(a.danger) - Number(b.danger));
  },

  /** ECU 的顯示列；沒有回報的欄位不列，列出來一片空白比不列更難讀 */
  ecuRows(ecu) {
    if (!ecu) return [];

    return [
      { label: '電壓', value: ecu.voltageV, unit: 'V', digits: 1 },
      { label: '轉速', value: ecu.rpm, unit: 'rpm' },
      { label: '里程表', value: ecu.odometerKm, unit: 'km', digits: 1 },
      { label: '水溫', value: ecu.coolantC, unit: '°C' },
      { label: '油量', value: ecu.fuelPercent, unit: '%' }
    ]
      .filter((r) => r.value !== undefined && r.value !== null)
      .map((r) => ({ ...r, text: `${Number(r.value).toFixed(r.digits ?? 0)} ${r.unit}` }));
  }
};
