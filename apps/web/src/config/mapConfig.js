/**
 * 底圖設定。
 *
 * 預設用國土測繪中心的電子地圖(EMAP)：台灣的路名、門牌、行政界線都比 OSM 完整，
 * 而且是政府開放圖資，不需要金鑰 —— 對公共工程系統來說這兩點都重要。
 *
 * 其餘底圖各有用途：
 *   正射影像  現場人員找地標最快(「那棟紅色屋頂旁邊」)
 *   土地利用  判斷路段周邊是住宅還是工業區，影響施工時段
 *   Google    路網更新最快，但條款上不適合商用嵌入，僅供內部比對
 *   深色      看板整天掛著時比較不刺眼
 */
export const BASEMAPS = {
  EMAP: {
    label: '臺灣電子地圖',
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.nlsc.gov.tw">內政部國土測繪中心</a>',
    dark: false
  },
  EMAP_T: {
    label: '通用電子地圖',
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP2/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.nlsc.gov.tw">內政部國土測繪中心</a>',
    dark: false
  },
  PHOTO: {
    label: '正射影像',
    url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.nlsc.gov.tw">內政部國土測繪中心</a>',
    dark: true
  },
  LUIMAP: {
    label: '土地利用',
    url: 'https://wmts.nlsc.gov.tw/wmts/LUIMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.nlsc.gov.tw">內政部國土測繪中心</a>',
    dark: false
  },
  OSM: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    dark: false
  },
  CARTO_DARK: {
    label: '深色地圖',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
    dark: true
  },
  CARTO_LIGHT: {
    label: '淺色地圖',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
    dark: false
  },
  GOOGLE_ROAD: {
    label: 'Google 街道',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google',
    dark: false,
    // 直接取用 mt1 圖磚不在 Google 的授權範圍內；正式對外站台要改用官方 SDK
    notice: '僅供內部比對，商用需改用官方 Maps SDK'
  },
  GOOGLE_SAT: {
    label: 'Google 衛星',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attribution: '&copy; Google',
    dark: true,
    notice: '僅供內部比對，商用需改用官方 Maps SDK'
  },
  GOOGLE_HYBRID: {
    label: 'Google 混合',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google',
    dark: true,
    notice: '僅供內部比對，商用需改用官方 Maps SDK'
  }
};

/** 預設底圖：政府圖資、免金鑰、台灣路名最完整 */
export const DEFAULT_BASEMAP = 'EMAP';

/** 底圖分組，讓選單不是一長串 */
export const BASEMAP_GROUPS = [
  { label: '政府圖資', keys: ['EMAP', 'EMAP_T', 'PHOTO', 'LUIMAP'] },
  { label: '開放圖資', keys: ['OSM', 'CARTO_DARK', 'CARTO_LIGHT'] },
  { label: 'Google', keys: ['GOOGLE_ROAD', 'GOOGLE_SAT', 'GOOGLE_HYBRID'] }
];
