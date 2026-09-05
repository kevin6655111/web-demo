import { createTheme } from '@mui/material/styles';

/**
 * MUI 主題。
 *
 * 巡查看板多半掛在辦公室的牆上整天開著，深色底比較不刺眼；
 * 日夜兩套共用同一組語意色，換佈景不該換掉「這個顏色代表什麼」。
 *
 * **中文標籤與狀態色不在這裡** —— 那是領域語彙，見 `config/vocabulary.js`，
 * 它由 `@road-patrol/shared` 的定義推導出來。放在主題裡會讓人以為
 * 「換個佈景就能改狀態名稱」。
 */

export function createAppTheme(mode = 'dark') {
  const dark = mode === 'dark';

  // 框線與分隔線在兩種底色下要用不同的透明度，否則淺色模式看起來像沒有框線
  const border = dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.09)';

  /*
   * 日間的層次靠陰影，不靠框線。
   *
   * 深色介面可以用「比背景亮一點」來表示浮起，淺色不行 ——
   * 白卡片放在白底上只會變成一片白。所以日間改用兩層陰影：
   * 一道緊貼邊緣的細影定義輪廓，一道大範圍的淡影做出高度。
   */
  const lift = '0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 32px -18px rgba(15, 23, 42, 0.28)';

  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#38bdf8' : '#0284c7' },
      secondary: { main: dark ? '#a78bfa' : '#7c3aed' },
      success: { main: dark ? '#34d399' : '#059669' },
      warning: { main: dark ? '#fbbf24' : '#d97706' },
      error: { main: dark ? '#f87171' : '#dc2626' },
      info: { main: dark ? '#38bdf8' : '#0284c7' },
      divider: border,
      background: dark
        ? { default: '#0b1220', paper: 'rgba(17, 25, 40, 0.86)' }
        : // 底色帶一點冷灰藍而不是純白：白卡片要有東西可以浮在上面
          { default: '#eef1f7', paper: '#ffffff' },
      text: dark ? { primary: '#e2e8f0', secondary: '#94a3b8' } : { primary: '#0f172a', secondary: '#475569' },
      action: dark ? {} : { hover: 'rgba(15, 23, 42, 0.035)', selected: 'rgba(15, 23, 42, 0.06)' }
    },
    typography: {
      fontFamily: '"Noto Sans TC", system-ui, -apple-system, "Segoe UI", sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700 },
      // 數字用等寬字：看板上的數字每秒在跳，非等寬會讓整行左右晃
      caption: { fontFamily: '"JetBrains Mono", monospace' }
    },
    shape: { borderRadius: 14 },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${border}`,
            // 毛玻璃只在深色下成立：淺色底做模糊會讓文字邊緣發灰
            ...(dark ? { backdropFilter: 'blur(12px)' } : { boxShadow: lift })
          }
        }
      },
      // 表頭給一條淡色帶：一整片白的表格，捲動時分不出哪一列是標題
      MuiTableHead: {
        styleOverrides: {
          root: dark ? {} : { background: 'linear-gradient(180deg, #f8fafc, #eef2f8)' }
        }
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700, letterSpacing: '0.01em' }
        }
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 3, borderRadius: 3 }
        }
      },
      MuiDialog: {
        styleOverrides: {
          paper: dark ? {} : { boxShadow: '0 24px 64px -24px rgba(15, 23, 42, 0.45)' }
        }
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } } }
    }
  });
}

/** 預設佈景；元件測試不需要切換，直接用這一份 */
export const theme = createAppTheme('dark');
