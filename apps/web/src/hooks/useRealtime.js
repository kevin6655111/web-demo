import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT } from '../models/api/apiRequest';

/**
 * WebSocket 連線。
 *
 * 三件事讓它在真實網路下還能用：
 *   1. 指數退避重連 —— 行動網路斷線是常態，固定間隔重連會在伺服器重啟時造成雪崩
 *   2. 應用層 ping —— 中間的代理常在 60 秒閒置後切線，我們主動送
 *   3. 掛載時取「現在」、連線後收「之後」—— 少了任何一邊畫面都會不完整
 */
export function useRealtime({ channels = ['case'], onMessage, enabled = true }) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const retryRef = useRef(0);
  const handlerRef = useRef(onMessage);
  const closedRef = useRef(false);

  // 用 ref 保存最新的 handler：避免 handler 每次 render 變動就重連
  handlerRef.current = onMessage;

  const send = useCallback((message) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    closedRef.current = false;
    let pingTimer;
    let retryTimer;

    const connect = () => {
      if (closedRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
        socket.send(JSON.stringify({ type: 'subscribe', channels }));
        pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), 20000);
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current?.(JSON.parse(event.data));
        } catch {
          // 壞掉的單一訊息不該讓整條連線陣亡
        }
      };

      socket.onclose = (event) => {
        setConnected(false);
        clearInterval(pingTimer);
        if (closedRef.current) return;

        // 4001/4003 是伺服器明確拒絕(沒帶 token / token 無效)：
        // 重連再多次也不會成功，直接走憑證失效流程
        // 用選擇性存取：瀏覽器一定會給 event，但測試替身與某些環境不一定
        if (event?.code === 4001 || event?.code === 4003) {
          window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
          return;
        }

        // 指數退避，上限 15 秒：伺服器重啟時所有前端不會同時湧上來
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        retryTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      closedRef.current = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [enabled, channels.join(',')]);

  return { connected, send };
}
