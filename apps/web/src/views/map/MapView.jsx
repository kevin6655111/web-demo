import { useMemo, useState } from 'react';
import { Alert, Box, Paper, Stack, Tab, Tabs, useMediaQuery, useTheme } from '@mui/material';
import { MapProvider } from '../../context/MapContext';
import { useSidebarConfig } from '../../hooks/useSidebarConfig';
import MapCanvas from './MapCanvas';
import LayerControlPanel from './tool/LayerControlPanel';
import QVehicleCrack from './panel/QVehicleCrack';
import QVehicleTrack from './panel/QVehicleTrack';
import QFleetMonitor from './panel/QFleetMonitor';
import QRoadEval from './panel/QRoadEval';
import QGIS from './panel/QGIS';
import QRoadSetting from './panel/QRoadSetting';
import QPatrolPoint from './panel/QPatrolPoint';

/** 面板名稱對應到後端導覽定義的 COMPONENT */
const PANELS = { QVehicleCrack, QVehicleTrack, QFleetMonitor, QRoadEval, QRoadSetting, QPatrolPoint, QGIS };

/**
 * 圖台。
 *
 * **一張地圖、多個查詢面板**：切換頁籤只換左側的查詢條件，
 * 已載入的圖層留在地圖上。所以「這條軌跡有沒有經過那幾個坑洞」
 * 這種需要兩個圖層疊看的問題，在這裡回答得了。
 *
 * 每個面板負責「查什麼」，地圖負責「怎麼畫」，圖層控制負責「顯示哪些」——
 * 三者分開之後，新增一種圖層不需要動到另外兩邊。
 */
export default function MapView() {
  const { nav, loading } = useSidebarConfig();
  const [active, setActive] = useState(null);
  const theme = useTheme();

  // 用斷點決定「面板放哪」而不是用 CSS 顯示兩份 ——
  // MUI 的 display 只是隱藏，兩份都會掛載，於是資料抓兩遍、圖層登錄兩遍
  const wide = useMediaQuery(theme.breakpoints.up('lg'));

  const features = useMemo(() => nav.find((m) => m.id === 'MAP_MOD')?.subNav ?? [], [nav]);
  const current = active ?? features[0]?.id;
  const Panel = PANELS[features.find((f) => f.id === current)?.component];

  if (loading) return null;
  if (!features.length) return <Alert severity="info">沒有可用的圖台功能</Alert>;

  return (
    <MapProvider>
      <Stack spacing={2}>
        <Tabs
          value={current ?? false}
          onChange={(_, v) => setActive(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
        >
          {features.map((f) => (
            <Tab
              key={f.id}
              value={f.id}
              label={f.title}
              icon={<Box sx={{ display: 'flex', fontSize: 16 }}>{f.icon}</Box>}
              iconPosition="start"
            />
          ))}
        </Tabs>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexDirection: wide ? 'row' : 'column' }}>
          {/* 寬螢幕放左欄，窄螢幕放地圖上方；無論如何只渲染一次 */}
          <Stack spacing={2} sx={{ width: wide ? 320 : '100%', flexShrink: 0 }}>
            {Panel ? <Panel /> : <Alert severity="warning">此功能尚未實作前端元件</Alert>}

            <Paper sx={{ p: 2 }}>
              <LayerControlPanel />
            </Paper>
          </Stack>

          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            <MapCanvas />
          </Box>
        </Box>
      </Stack>
    </MapProvider>
  );
}
