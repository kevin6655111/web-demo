import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../models/api/patrolApi';
import { AUTH_EXPIRED_EVENT } from '../models/api/apiRequest';

/**
 * 主動續期的時機。
 *
 * Token 有效 30 分鐘。在剩下三分之一時就換新的：
 * 太早換等於沒有有效期限，太晚換則會在網路抖動時剛好錯過那一次。
 */
const REFRESH_INTERVAL_MS = 20 * 60_000;

/**
 * 曾經登入過的標記。
 *
 * 用來區分兩種「沒有登入」：從沒登入過(直接開網址)、以及登入後過期。
 * 前者不該看到「登入已過期」的提示 —— 那會讓人以為自己做錯了什麼。
 *
 * 放 sessionStorage 而不是 state：憑證過期常常伴隨整頁重載，
 * state 在那一刻就沒了，但使用者仍然需要知道為什麼回到登入頁。
 */
const SESSION_FLAG = 'patrol:had-session';

function readExpiredFlag() {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === 'expired';
  } catch {
    // 無痕模式或關閉儲存時直接當作沒有旗標，不要讓整個 App 掛掉
    return false;
  }
}

function writeSessionFlag(value) {
  try {
    if (value) sessionStorage.setItem(SESSION_FLAG, value);
    else sessionStorage.removeItem(SESSION_FLAG);
  } catch {
    /* 同上 */
  }
}

const UserContext = createContext(null);

/**
 * 登入狀態。
 *
 * token 在 httpOnly cookie 裡，前端讀不到 —— 這是刻意的(XSS 也就偷不走)。
 * 因此「我是誰」只能問後端，掛載時打一次 prefs：
 * 有回應就是還登入著，401 就是沒有。
 */
export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expiredNotice, setExpiredNotice] = useState(readExpiredFlag() ? '登入已過期，請重新登入' : '');
  const userRef = useRef(null);

  userRef.current = user;

  useEffect(() => {
    authApi
      .prefs()
      .then((res) => {
        setUser(res.data);
        writeSessionFlag('active');
        setExpiredNotice('');
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  /**
   * 憑證失效時統一踢出。
   *
   * 沒有這個的話，使用者會停在一個看起來正常、但每個操作都失敗的畫面上 ——
   * 那比直接回登入頁更讓人困惑。
   */
  useEffect(() => {
    const onExpired = () => {
      // 從沒登入過的人不該看到「已過期」——那會讓人以為自己做錯了什麼
      let hadSession = false;
      try {
        hadSession = !!sessionStorage.getItem(SESSION_FLAG);
      } catch {
        hadSession = false;
      }

      if (!userRef.current && !hadSession) return;

      setUser(null);
      // 寫進 sessionStorage：憑證過期常伴隨整頁重載，state 那時已經沒了
      writeSessionFlag('expired');
      setExpiredNotice('登入已過期，請重新登入');
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  /**
   * 主動續期。
   *
   * 使用者在畫面上連續操作了 25 分鐘，不該因為 token 到期就被踢出去。
   * 續期失敗不當作錯誤處理 —— 401 會由上面的事件接手，其餘(例如暫時斷網)
   * 等下一輪再試就好。
   */
  useEffect(() => {
    if (!user) return undefined;

    const timer = setInterval(() => {
      authApi.refresh().catch(() => {});
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [user]);

  const login = useCallback(async (companyKey, account, password) => {
    const res = await authApi.login(companyKey, account, password);
    setExpiredNotice('');
    writeSessionFlag('active');
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    // 主動登出不是「過期」，把旗標清乾淨，下次進來不要顯示提示
    writeSessionFlag(null);
    setExpiredNotice('');
    setUser(null);
  }, []);

  /** 權限判斷集中在這裡：畫面只問「我能不能做這件事」，不自己解析權限字串 */
  const can = useCallback((action) => !!user?.actions?.includes(action), [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      can,
      expiredNotice,
      clearExpiredNotice: () => {
        writeSessionFlag(null);
        setExpiredNotice('');
      }
    }),
    [user, loading, login, logout, can, expiredNotice]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser 必須在 UserProvider 內使用');
  return ctx;
}
