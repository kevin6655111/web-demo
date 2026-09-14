import { StrictMode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRealtime } from '../hooks/useRealtime';

/** 可控的假 WebSocket：讓測試決定何時開、何時斷 */
class FakeWebSocket {
  static instances = [];
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  /**
   * 瀏覽器的 close() 只是「開始關」：readyState 立刻變，
   * onclose 要等回合結束之後才送達。這個時間差正是連線外洩的成因，
   * 替身同步觸發的話就永遠測不到。
   */
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // 真實的瀏覽器一定會帶 CloseEvent，替身也要帶 —— 否則測不到依 code 分支的邏輯
    setTimeout(() => this.onclose?.({ code, reason: '' }), 0);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

/**
 * 這個 hook 的價值全在「網路不乖」的時候：
 * 斷線要退避重連、要送心跳、壞掉的單一訊息不能拖垮整條連線。
 * 這三件事沒辦法用純函式測，所以才值得寫成元件層測試。
 */
describe('useRealtime', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('連線後自動訂閱指定頻道', () => {
    renderHook(() => useRealtime({ channels: ['case', 'report'], onMessage: vi.fn() }));

    act(() => FakeWebSocket.instances[0].open());

    expect(FakeWebSocket.instances[0].sent[0]).toEqual({ type: 'subscribe', channels: ['case', 'report'] });
  });

  it('定期送出心跳，避免中間的代理把閒置連線切掉', () => {
    renderHook(() => useRealtime({ channels: ['case'], onMessage: vi.fn() }));
    act(() => FakeWebSocket.instances[0].open());

    act(() => vi.advanceTimersByTime(41000));

    const pings = FakeWebSocket.instances[0].sent.filter((m) => m.type === 'ping');
    expect(pings.length).toBe(2);
  });

  it('斷線後退避重連，而不是立刻重試造成雪崩', () => {
    renderHook(() => useRealtime({ channels: ['case'], onMessage: vi.fn() }));
    act(() => FakeWebSocket.instances[0].open());

    act(() => FakeWebSocket.instances[0].close());
    expect(FakeWebSocket.instances).toHaveLength(1); // 沒有立刻重連

    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2); // 第一次退避 1 秒
  });

  it('壞掉的訊息不會讓連線陣亡，後續訊息照常送達', () => {
    const onMessage = vi.fn();
    renderHook(() => useRealtime({ channels: ['case'], onMessage }));

    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    act(() => socket.onmessage({ data: '{壞掉的 json' }));
    act(() => socket.emit({ type: 'case.created', data: { caseId: 1 } }));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: 'case.created', data: { caseId: 1 } });
  });

  it('伺服器拒絕憑證(4003)時不重連，改走憑證失效流程', () => {
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);

    renderHook(() => useRealtime({ channels: ['case'], onMessage: vi.fn() }));
    act(() => FakeWebSocket.instances[0].open());

    act(() => FakeWebSocket.instances[0].close(4003));
    act(() => vi.advanceTimersByTime(30000));

    // 憑證無效時重連再多次也不會成功，只會洗版
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onExpired).toHaveBeenCalled();

    window.removeEventListener('auth:expired', onExpired);
  });

  it('StrictMode 重掛載不會留下沒人管的連線', () => {
    renderHook(() => useRealtime({ channels: ['case'], onMessage: vi.fn() }), { wrapper: StrictMode });

    // StrictMode 會刻意跑一次「掛載→卸載→再掛載」：第一條被關掉，第二條才是要留下的
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => FakeWebSocket.instances[1].open());

    // 第一條的 close 事件在這時候才抵達 —— 它屬於已經結束的那一輪，不該觸發重連
    act(() => vi.advanceTimersByTime(30000));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.filter((s) => s.readyState !== 3)).toHaveLength(1);
  });

  it('卸載後不再重連', () => {
    const { unmount } = renderHook(() => useRealtime({ channels: ['case'], onMessage: vi.fn() }));
    act(() => FakeWebSocket.instances[0].open());

    unmount();
    act(() => vi.advanceTimersByTime(30000));

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
