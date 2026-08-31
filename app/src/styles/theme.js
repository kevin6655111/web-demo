import { createTheme } from '@mui/material/styles';

/**
 * 深色主題。
 *
 * 巡查看板多半掛在辦公室的牆上整天開著，深色底比較不刺眼；
 * 案件狀態各有固定顏色，全系統共用，讓人看顏色就知道狀態，不必讀字。
 */
/**
 * 二篩狀態(status)：AI 判讀出來的案件要先經人工確認才算數。
 * 與案件狀態是兩回事 —— 通過二篩的案件才會進入派工流程。
 */
export const CASE_STATUS_LABEL = { 0: '未審', 1: '通過', 2: '待審', 3: '刪除', 4: '誤判' };
export const CASE_STATUS_COLOR = {
  0: 'var(--c-neutral)',
  1: 'var(--c-success)',
  2: 'var(--c-warning)',
  3: 'var(--c-muted)',
  4: 'var(--c-error)'
};

/**
 * 案件狀態(needRepair)：地圖與看板的顏色主要看這個。
 *
 * **沒有「已完修」這個值** —— 修完了是派工單的事實(status=3)，不是案件的狀態。
 * 硬塞一個值進去，同一個欄位就會表達兩件事，而報表要分開統計。
 */
export const NEED_REPAIR_LABEL = { '-1': '已刪除', 0: '待確認', 1: '觀察中', 2: '已派工' };
export const NEED_REPAIR_COLOR = {
  '-1': 'var(--c-error)',
  0: 'var(--c-warning)',
  1: 'var(--c-info)',
  2: 'var(--c-success)'
};

/** 人工編輯註記：稽核要看的是「這筆有沒有被人動過」 */
export const EDITED_LABEL = { 0: '未編輯', 1: '已編輯' };

/** 破壞程度 */
export const DEGREE_LABEL = { A: '嚴重', B: '中等', C: '輕微' };
export const DEGREE_COLOR = { A: 'var(--c-error)', B: 'var(--c-warning)', C: 'var(--c-neutral)' };

/**
 * 破壞類型。
 *
 * key 沿用判讀模型輸出的字串（大小寫也照抄）—— 那是資料庫裡實際存的值，
 * 在前端「整理」成大寫看起來比較整齊，代價是每次比對都要先轉換一次，
 * 而漏轉的地方會安靜地顯示成原始代碼。
 */
export const CRACK_LABEL = {
  Cover: '人手孔蓋未平順',
  Potholes: '坑洞',
  Patch: '補綻',
  Cracking: '線狀裂縫',
  Alligator_Cracking: '鱷魚狀裂縫',
  Rutting: '車轍',
  Subsidence: '路基下陷'
};

/** 案件來源：三種來源在畫面上是三個分頁，資料上是同一張表 */
export const SOURCE_LABEL = {
  VEHICLE: 'AI 車巡',
  APP: 'APP 巡查',
  SIDEWALK: '通道案件'
};

/** 車輛狀態 */
export const VEHICLE_STATE_LABEL = { ONLINE: '在線', IDLE: '待命', OFFLINE: '離線', DISABLED: '停用' };
export const VEHICLE_STATE_COLOR = {
  ONLINE: 'var(--c-success)',
  IDLE: 'var(--c-info)',
  OFFLINE: 'var(--c-neutral)',
  DISABLED: 'var(--c-error)'
};

export const VEHICLE_TYPE_LABEL = { PATROL: '巡查車', REPAIR: '維修車', SURVEY: '檢測車' };

/**
 * 養護等級色票。
 * 用紅綠燈的直覺順序：綠→黃→橘→紅，不需要圖例也看得懂哪個嚴重。
 */
export const MAINTAIN_LABEL = { GOOD: '良好', FAIR: '尚可', POOR: '不良', CRITICAL: '危險' };
export const MAINTAIN_COLOR = {
  GOOD: 'var(--c-success)',
  FAIR: 'var(--c-warning)',
  POOR: 'var(--c-purple)',
  CRITICAL: 'var(--c-error)'
};

/** 鋪面調查 */
export const SURVEY_METHOD_LABEL = { VISUAL: '目視', CORE_DRILL: '鑽心取樣', FWD: '落重撓度', ROUGHNESS: '平坦度' };
export const SURVEY_ORDER_STATE_LABEL = { DRAFT: '草稿', ISSUED: '已發出', SURVEYING: '調查中', REVIEWING: '審核中', CLOSED: '結案' };

/** 派工單狀態 */
export const WORK_ORDER_LABEL = { '-1': '已刪除', 0: '待處理', 1: '施工中', 2: '已回報', 3: '已完工' };
export const WORK_ORDER_COLOR = {
  '-1': 'var(--c-error)',
  0: 'var(--c-neutral)',
  1: 'var(--c-warning)',
  2: 'var(--c-info)',
  3: 'var(--c-success)'
};

/** 檢測案件狀態 */
export const SURVEY_STATUS_LABEL = { '-1': '已刪除', 0: '未檢查', 1: '已檢查' };

/** 派工單類型：PC/PD 是從既有案件轉來的，所以一定帶得到來源案件 */
export const WORK_ORDER_TYPE_LABEL = { PA: '刨除加封', PB: '路基改善', PC: 'AI 車巡案件', PD: 'APP 巡查案件' };

/** 施工材料 */
export const MATERIAL_LABEL = { AC: '瀝青混凝土', CC: '水泥混凝土', COLD: '冷瀝青', OTHER: '其他' };

/** 標案狀態 */
export const PROJECT_STATE_LABEL = { DRAFT: '草稿', ACTIVE: '執行中', CLOSED: '已結案' };

/**
 * 建立主題。
 *
 * 日夜共用同一組語意色（primary/success/warning/error）——
 * 那些顏色在畫面上代表「狀態」，換了佈景不該換意思：
 * 綠色在夜間是完成、在日間也必須是完成。
 *
 * 真正切換的是背景、文字與框線 —— 也就是「紙」與「墨」。
 * 淺色的框線與陰影要重新調過：深色底用半透明白線就看得清楚，
 * 同一條線放在白底上會幾乎消失。
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
