import { useEffect, useMemo, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Box,
  Divider,
  IconButton,
  Paper,
  Popover,
  Slider,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import MapIcon from '@mui/icons-material/Map';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import StraightenIcon from '@mui/icons-material/Straighten';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import StreetviewIcon from '@mui/icons-material/Streetview';
import { BASEMAPS, BASEMAP_GROUPS } from '../../../config/mapConfig';

/** 工具列按鈕：統一樣式，避免每支工具各自長一個樣 */
function ToolButton({ title, active, onClick, children }) {
  return (
    <Tooltip title={title} placement="left">
      <IconButton
        size="small"
        onClick={onClick}
        sx={{
          bgcolor: active ? 'primary.main' : 'background.paper',
          color: active ? 'primary.contrastText' : 'text.primary',
          border: (t) => `1px solid ${t.palette.divider}`,
          '&:hover': { bgcolor: active ? 'primary.light' : 'rgba(30,41,59,0.95)' }
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

/**
 * 地圖工具列。
 *
 * 五個工具都是「地圖上真的會用到」而不是為了展示：
 *   底圖切換  現場人員習慣看衛星圖找地標，辦公室習慣看街道圖
 *   圖層控制  疊了四五層之後，看清楚一層的唯一方法是關掉其他層
 *   座標定位  民眾檢舉常常只給經緯度
 *   距離量測  「這段要刨多長」現場最常問的問題
 *   全螢幕    投影到會議室螢幕時用
 *
 * 工具狀態由呼叫端持有(受控元件)：地圖頁面之間切換時，
 * 使用者選好的圖層與底圖不該被重置。
 */
export default function MapTools({
  basemap,
  onBasemapChange,
  layers = [],
  onLayerToggle,
  onLayerOpacity,
  onLayerMode,
  onStreetView
}) {
  const map = useMap();
  const [anchor, setAnchor] = useState(null);
  const [panel, setPanel] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [coord, setCoord] = useState({ lng: '', lat: '' });
  const [measured, setMeasured] = useState(null);
  const [pegman, setPegman] = useState(false);

  const open = (name) => (e) => {
    setPanel(name);
    setAnchor(e.currentTarget);
  };

  const close = () => {
    setAnchor(null);
    setPanel(null);
  };

  // ─── 距離量測 ────────────────────────────────────────────────
  useEffect(() => {
    if (!measuring) return undefined;

    const points = [];
    const group = L.layerGroup().addTo(map);

    const onClick = (e) => {
      points.push(e.latlng);
      L.circleMarker(e.latlng, { radius: 4, color: '#38bdf8', fillOpacity: 1 }).addTo(group);

      if (points.length > 1) {
        L.polyline(points, { color: '#38bdf8', weight: 3, dashArray: '6 4' }).addTo(group);

        // 累計距離用 Leaflet 的大圓距離，不自己寫 haversine
        const meters = points.slice(1).reduce((sum, p, i) => sum + points[i].distanceTo(p), 0);
        setMeasured(meters);
      }
    };

    map.on('click', onClick);
    map.getContainer().style.cursor = 'crosshair';

    return () => {
      map.off('click', onClick);
      map.getContainer().style.cursor = '';
      group.remove();
      setMeasured(null);
    };
  }, [measuring, map]);

  /**
   * 街景模式。
   *
   * 用「點一下地圖」而不是 Google 那種拖曳小人：
   * 拖曳在觸控裝置上很難操作，而現場人員多半用平板。
   */
  useEffect(() => {
    if (!pegman) return undefined;

    const onClick = (e) => {
      onStreetView?.({ lng: e.latlng.lng, lat: e.latlng.lat });
      setPegman(false);
    };

    map.on('click', onClick);
    map.getContainer().style.cursor = 'pointer';

    return () => {
      map.off('click', onClick);
      map.getContainer().style.cursor = '';
    };
  }, [pegman, map, onStreetView]);

  const flyToCoord = () => {
    const lng = Number(coord.lng);
    const lat = Number(coord.lat);
    // 座標打錯時什麼都不做，比把地圖飛到大西洋好
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    map.flyTo([lat, lng], 17, { duration: 0.8 });
    L.circleMarker([lat, lng], { radius: 10, color: '#f472b6', weight: 3 }).addTo(map);
    close();
  };

  const toggleFullscreen = () => {
    const el = map.getContainer().closest('[data-map-shell]') ?? map.getContainer();
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <>
      <Stack spacing={0.8} sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1000 }}>
        <ToolButton title="底圖" active={panel === 'basemap'} onClick={open('basemap')}>
          <MapIcon fontSize="small" />
        </ToolButton>

        {layers.length > 0 && (
          <ToolButton title="圖層控制" active={panel === 'layers'} onClick={open('layers')}>
            <LayersIcon fontSize="small" />
          </ToolButton>
        )}

        <ToolButton title="座標定位" active={panel === 'locate'} onClick={open('locate')}>
          <MyLocationIcon fontSize="small" />
        </ToolButton>

        <ToolButton
          title={measuring ? '結束量測' : '距離量測'}
          active={measuring}
          onClick={() => setMeasuring((v) => !v)}
        >
          <StraightenIcon fontSize="small" />
        </ToolButton>

        {onStreetView && (
          <ToolButton
            title={pegman ? '取消街景' : '街景：點地圖選位置'}
            active={pegman}
            onClick={() => setPegman((v) => !v)}
          >
            <StreetviewIcon fontSize="small" />
          </ToolButton>
        )}

        <ToolButton title="全螢幕" onClick={toggleFullscreen}>
          <FullscreenIcon fontSize="small" />
        </ToolButton>
      </Stack>

      {(measuring || pegman) && (
        <Paper
          sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, px: 2, py: 1 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="body2">
              {pegman
                ? '點擊地圖上的位置開啟街景'
                : measured === null
                  ? '點擊地圖開始量測，再點下一點'
                  : measured >= 1000
                    ? `${(measured / 1000).toFixed(2)} 公里`
                    : `${measured.toFixed(0)} 公尺`}
            </Typography>
            <IconButton
              size="small"
              onClick={() => {
                setMeasuring(false);
                setPegman(false);
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Paper>
      )}

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 230 } } }}
      >
        {panel === 'basemap' && (
          <Stack spacing={1.5} sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {BASEMAP_GROUPS.map((group) => (
              <Box key={group.label}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {group.label}
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  orientation="vertical"
                  value={basemap}
                  onChange={(_, v) => v && onBasemapChange(v)}
                  sx={{ width: '100%' }}
                >
                  {group.keys.map((key) => (
                    <ToggleButton key={key} value={key} sx={{ justifyContent: 'flex-start', fontSize: 12 }}>
                      {BASEMAPS[key].label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
            ))}

            {BASEMAPS[basemap]?.notice && (
              <Typography variant="caption" color="warning.main">
                ⚠ {BASEMAPS[basemap].notice}
              </Typography>
            )}
          </Stack>
        )}

        {panel === 'layers' && (
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">圖層</Typography>
            {layers.map((l) => (
              <Box key={l.key}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: l.color ?? 'primary.main' }} />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {l.label}
                    {l.count !== undefined && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                        ({l.count})
                      </Typography>
                    )}
                  </Typography>
                  <Switch size="small" checked={l.visible} onChange={() => onLayerToggle(l.key)} />
                </Stack>

                {/* 點位圖層才有三種畫法；線圖層切換聚合沒有意義 */}
                {l.visible && l.modes && onLayerMode && (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    fullWidth
                    value={l.mode ?? 'point'}
                    onChange={(_, v) => v && onLayerMode(l.key, v)}
                    sx={{ mt: 0.6, '& .MuiToggleButton-root': { py: 0.2, fontSize: 10 } }}
                  >
                    {l.modes.map((m) => (
                      <ToggleButton key={m.value} value={m.value}>
                        {m.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                )}

                {l.visible && onLayerOpacity && l.mode !== 'heat' && (
                  <Slider
                    size="small"
                    value={l.opacity ?? 1}
                    min={0.2}
                    max={1}
                    step={0.1}
                    onChange={(_, v) => onLayerOpacity(l.key, v)}
                    sx={{ mt: -0.5 }}
                  />
                )}
              </Box>
            ))}
          </Stack>
        )}

        {panel === 'locate' && (
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">座標定位</Typography>
            <Typography variant="caption" color="text.secondary">
              民眾檢舉常常只給經緯度
            </Typography>
            <TextField
              size="small"
              label="經度"
              value={coord.lng}
              onChange={(e) => setCoord({ ...coord, lng: e.target.value })}
            />
            <TextField
              size="small"
              label="緯度"
              value={coord.lat}
              onChange={(e) => setCoord({ ...coord, lat: e.target.value })}
            />
            <IconButton onClick={flyToCoord} sx={{ alignSelf: 'flex-end' }} color="primary">
              <SearchIcon />
            </IconButton>
          </Stack>
        )}
      </Popover>
    </>
  );
}
