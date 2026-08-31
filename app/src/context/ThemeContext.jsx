import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../styles/theme';

const STORAGE_KEY = 'patrol:theme';

const ThemeModeContext = createContext({ mode: 'dark', toggle: () => {}, setMode: () => {} });

/** 讀使用者上次的選擇；沒選過就跟著作業系統走 */
function initialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // 無痕視窗或封鎖儲存時會丟例外；讀不到就用系統偏好，不該讓整個 App 起不來
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * 日夜佈景。
 *
 * 巡查系統白天在工地、晚上在辦公室都會用 ——
 * 戶外強光下深色底幾乎看不見，而深夜盯著白底看兩小時同樣不合理。
 *
 * 選擇記在 localStorage 而不是伺服器：這是「這台裝置上看起來如何」，
 * 不是帳號設定。同一個人用平板在現場、用桌機在辦公室，本來就該不一樣。
 */
export function AppThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 存不起來只是下次要重選，不影響這次的使用
    }

    // CSS 那邊只認這個屬性 —— 地圖圖磚的濾鏡、捲軸、popup 都跟著它換。
    // 讓 CSS 自己去判斷系統偏好的話，JS 已經切好了而 CSS 還停在上一個狀態
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), []);

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const value = useMemo(() => ({ mode, toggle, setMode }), [mode, toggle]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export const useThemeMode = () => useContext(ThemeModeContext);
