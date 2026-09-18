import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, Popup, TileLayer, Tooltip as LTooltip, useMap } from 'react-leaflet';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import CaseLayer from './layer/CaseLayer';
import MapTools from './tool/MapTools';
import StreetView from './tool/StreetView';
import { BASEMAPS } from '../../config/mapConfig';
import { useMapLayers } from '../../context/MapContext';
import { MAINTAIN_COLOR, MAINTAIN_LABEL, VEHICLE_STATE_COLOR, VEHICLE_STATE_LABEL } from '../../config/vocabulary';
import { CasePresenter } from '../../presenters/CasePresenter';

const CENTER = [24.1636, 120.6478];

/** 依速度上色：塞車與正常行駛在軌跡上要分得出來 */
function speedColor(kph) {
  if (kph < 10) return '#f87171';
  if (kph < 30) return '#fbbf24';
  return '#34d399';
}

/** 收到 fitTo 指令時把視野帶到該圖層的資料範圍 */
function FitController({ layers, fitKey }) {
  const map = useMap();

  useEffect(() => {
    if (!fitKey) return;

    const layer = layers.find((l) => l.key === fitKey.key);
    const bounds = layer?.bounds?.();
    if (bounds?.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }, [fitKey, layers, map]);

  return null;
}

/**
 * 圖台的地圖本體。
 *
 * 整個圖台只有這一張地圖，所有功能的圖層都畫在上面 ——
 * 破壞案件、軌跡、車輛、路段、巡查計畫可以任意組合疊看。
 *
 * 各圖層的實際畫法依 `type` 分派：這裡是唯一知道「怎麼畫」的地方，
 * 功能面板只負責「畫什麼」(資料)與「要不要畫"(開關)。
 */
export default function MapCanvas({ height = 'calc(100vh - 210px)' }) {
  const { layers, basemap, setBasemap, street, setStreet, fitKey, toggleLayer, setLayerOpacity, setLayerMode } =
    useMapLayers();
  const base = BASEMAPS[basemap];

  const visible = useMemo(() => layers.filter((l) => l.visible && l.data?.length), [layers]);

  return (
    <Box data-map-shell sx={{ position: 'relative', height, minHeight: 420 }}>
      <Paper sx={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
        <MapContainer
          center={CENTER}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          preferCanvas
          zoomControl={false}
        >
          <TileLayer
            key={basemap}
            url={base.url}
            attribution={base.attribution}
            maxZoom={19}
            className={base.dark ? 'basemap-dark' : undefined}
          />

          <FitController layers={layers} fitKey={fitKey} />

          <MapTools
            basemap={basemap}
            onBasemapChange={setBasemap}
            layers={layers}
            onLayerToggle={toggleLayer}
            onLayerOpacity={setLayerOpacity}
            onLayerMode={setLayerMode}
            onStreetView={setStreet}
          />

          {visible.map((layer) => (
            <LayerRenderer key={layer.key} layer={layer} />
          ))}
        </MapContainer>

        <StreetView point={street} onClose={() => setStreet(null)} />

        {/* 圖例：疊了四五層之後，沒有圖例就分不出哪條線是什麼 */}
        {visible.length > 1 && (
          <Paper sx={{ position: 'absolute', left: 12, bottom: 12, px: 1.5, py: 1, zIndex: 900 }}>
            <Stack spacing={0.4}>
              {visible.map((l) => (
                <Stack key={l.key} direction="row" spacing={0.8} alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: l.color }} />
                  <Typography variant="caption">
                    {l.label}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.4 }}>
                      {l.count}
                    </Typography>
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
      </Paper>
    </Box>
  );
}

/** 依圖層型別分派畫法 */
function LayerRenderer({ layer }) {
  const opacity = layer.opacity ?? 1;

  if (layer.type === 'case') {
    return <CaseLayer features={layer.data} mode={layer.mode ?? 'point'} />;
  }

  if (layer.type === 'track') {
    const positions = layer.data.map((p) => [p.lat, p.lng]);
    if (positions.length < 2) return null;

    return (
      <>
        {/* 底線一條保持連續，速度分段疊在上面 */}
        <Polyline positions={positions} pathOptions={{ color: layer.color, weight: 3, opacity: opacity * 0.35 }} />

        {layer.data.slice(1).map((p, i) => (
          <Polyline
            key={i}
            positions={[
              [layer.data[i].lat, layer.data[i].lng],
              [p.lat, p.lng]
            ]}
            pathOptions={{ color: speedColor(p.speedKph), weight: 4, opacity }}
          />
        ))}

        {layer.head && (
          <CircleMarker
            center={[layer.head.lat, layer.head.lng]}
            radius={8}
            pathOptions={{ color: '#f472b6', fillColor: '#f472b6', fillOpacity: 1, weight: 2 }}
          >
            <Popup>
              <Typography variant="body2">
                {CasePresenter.time(layer.head.recordedAt)}
                <br />
                時速 {layer.head.speedKph} km/h
              </Typography>
            </Popup>
          </CircleMarker>
        )}
      </>
    );
  }

  if (layer.type === 'line') {
    return layer.data.map((f) => {
      const p = f.properties;
      // 圖層可以自己決定每一條線的顏色(道路設定依管轄與是否納入上色)；
      // 沒給就用養護等級，再沒有就用圖層的基本色
      const color = layer.colorOf?.(p) ?? (p.maintainLevel ? (MAINTAIN_COLOR[p.maintainLevel] ?? layer.color) : layer.color);

      return (
        <Polyline
          key={p.id}
          positions={f.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
          pathOptions={{
            color,
            // 線寬跟著嚴重程度走：越該修的越粗，縮小地圖時仍然看得到
            weight: p.maintainLevel === 'CRITICAL' ? 8 : p.maintainLevel === 'POOR' ? 6 : 4,
            opacity,
            dashArray: layer.dashed ? '10 8' : undefined
          }}
        >
          <Popup>
            <Box sx={{ minWidth: 180 }}>
              <Typography variant="subtitle2">
                {p.roadName ?? p.name}
                {p.section ?? ''}
              </Typography>
              <Typography variant="caption" component="div" color="text.secondary">
                {p.code}
              </Typography>
              {p.pci !== undefined && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  PCI {Number(p.pci).toFixed(1)} · {MAINTAIN_LABEL[p.maintainLevel]}
                </Typography>
              )}
              {p.routeKm !== undefined && (
                <Typography variant="body2">路線 {Number(p.routeKm).toFixed(2)} km</Typography>
              )}
              {p.caseCount !== undefined && <Typography variant="body2">案件 {p.caseCount} 件</Typography>}
              {p.jurisdiction && (
                <Typography variant="body2">
                  管轄 {p.jurisdiction} · {p.isActive ? '納入巡查' : '排除'}
                </Typography>
              )}
              {p.lengthM !== undefined && <Typography variant="body2">長度 {Math.round(p.lengthM)} m</Typography>}
            </Box>
          </Popup>
        </Polyline>
      );
    });
  }

  /** 面圖層：道路區塊。用 Polygon 而不是把邊界畫成線 —— 面才點得到 */
  if (layer.type === 'polygon') {
    return layer.data.map((f) => {
      const p = f.properties;
      const color = layer.colorOf?.(p) ?? layer.color;

      return (
        <Polygon
          key={p.id}
          positions={f.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]))}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.35 * opacity, weight: 1.5, opacity }}
        >
          <Popup>
            <Box sx={{ minWidth: 180 }}>
              <Typography variant="subtitle2">{p.roadName}</Typography>
              <Typography variant="caption" component="div" color="text.secondary">
                {p.code}
              </Typography>
              {p.areaM2 !== undefined && <Typography variant="body2">面積 {Math.round(p.areaM2)} m²</Typography>}
              {p.laneCount !== undefined && <Typography variant="body2">車道 {p.laneCount}</Typography>}
            </Box>
          </Popup>
        </Polygon>
      );
    });
  }

  /**
   * 建物量體。
   *
   * **沒有做真正的 3D 拉伸** —— 那需要 deck.gl 或 MapLibre 這類 WebGL 繪圖層，
   * 而這張圖台是 Leaflet(SVG)。為了一個判讀用的輔助圖層換掉整個繪圖引擎、
   * 或多背幾百 KB 的第二套引擎，都不划算。
   *
   * 改用顏色深淺表達樓高：低樓層淺、高樓層深。這在「旁邊是透天還是大樓」
   * 這個實際要回答的問題上已經夠用，而且平面圖比斜視圖更容易對到路段位置。
   * 真正的樓層數在 popup 裡。這是取捨，不是做不到。
   */
  if (layer.type === 'building') {
    return layer.data.map((f) => {
      const p = f.properties;
      const color = layer.colorOf?.(p) ?? layer.color;

      return (
        <Polygon
          key={p.id}
          positions={f.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]))}
          pathOptions={{
            color,
            fillColor: color,
            // 樓越高越不透明：這是這個圖層唯一的「高度」訊號
            fillOpacity: Math.min(0.25 + p.levels * 0.045, 0.85) * opacity,
            weight: 0.6,
            opacity: opacity * 0.7
          }}
        >
          <Popup>
            <Box sx={{ minWidth: 170 }}>
              <Typography variant="subtitle2">{p.name ?? BUILDING_USAGE_LABEL[p.usage] ?? '建物'}</Typography>
              <Typography variant="caption" component="div" color="text.secondary">
                {p.district} · {BUILDING_USAGE_LABEL[p.usage] ?? p.usage}
              </Typography>
              <Typography variant="body2">
                {p.levels} 層 · 約 {Math.round(p.heightM ?? 0)} m
              </Typography>
              {p.areaM2 !== undefined && <Typography variant="body2">佔地 {Math.round(p.areaM2)} m²</Typography>}
            </Box>
          </Popup>
        </Polygon>
      );
    });
  }

  /**
   * 行政區界線。
   *
   * 只畫邊界不填色(`fillOpacity` 極低)：它是**參考框**而不是資料 ——
   * 填滿的話會把底下的案件與路段整個蓋掉，而使用者開這個圖層
   * 是為了看「案件落在哪一里」，不是為了看區塊本身。
   */
  if (layer.type === 'region') {
    return layer.data.map((f) => {
      const p = f.properties;

      return (
        <Polygon
          key={p.id}
          positions={f.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]))}
          pathOptions={{
            color: layer.color,
            fillColor: layer.color,
            fillOpacity: 0.04 * opacity,
            weight: 1.2,
            dashArray: '6 4',
            opacity
          }}
        >
          <Popup>
            <Box sx={{ minWidth: 150 }}>
              <Typography variant="subtitle2">{p.label}</Typography>
              <Typography variant="caption" component="div" color="text.secondary">
                {[p.county, p.district, p.village].filter(Boolean).join(' / ')}
              </Typography>
              {p.areaKm2 !== undefined && <Typography variant="body2">面積 {p.areaKm2} km²</Typography>}
            </Box>
          </Popup>
        </Polygon>
      );
    });
  }

  /**
   * GeoJSON 點圖層：巡查點。
   *
   * 與 `point` 型別的差別在資料形狀：這裡收的是 GeoJSON Feature，
   * 座標在 `geometry.coordinates`。多一種型別而不是在同一種裡判斷，
   * 是因為「這個圖層餵進來的是什麼」應該一眼看得出來。
   */
  if (layer.type === 'geojson-point') {
    return layer.data.map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const color = layer.colorOf?.(p) ?? layer.color;

      return (
        <CircleMarker
          key={p.id}
          center={[lat, lng]}
          radius={7}
          pathOptions={{ color, fillColor: color, fillOpacity: (p.isActive === false ? 0.3 : 0.8) * opacity, weight: 2 }}
        >
          <Popup>
            <Box sx={{ minWidth: 170 }}>
              <Typography variant="subtitle2">{p.name ?? p.code}</Typography>
              <Typography variant="caption" component="div" color="text.secondary">
                {p.code}
              </Typography>
              {p.radiusM !== undefined && <Typography variant="body2">判定半徑 {p.radiusM} m</Typography>}
              {p.district && <Typography variant="body2">{p.district}</Typography>}
            </Box>
          </Popup>
        </CircleMarker>
      );
    });
  }

  if (layer.type === 'vehicle') {
    return layer.data.map((v) => {
      const color = VEHICLE_STATE_COLOR[v.STATE] ?? layer.color;

      return (
        <CircleMarker
          key={v.ID}
          center={[v.LAT, v.LNG]}
          radius={v.LIVE ? 10 : 7}
          pathOptions={{
            color,
            fillColor: color,
            fillOpacity: (v.LIVE ? 0.85 : 0.4) * opacity,
            weight: v.LIVE ? 3 : 1
          }}
        >
          {/* 車牌直接標在地圖上：調度時要一眼看出是哪台 */}
          <LTooltip permanent direction="top" offset={[0, -8]} opacity={0.9}>
            <span style={{ fontSize: 11 }}>{v.PLATE_NO}</span>
          </LTooltip>

          <Popup>
            <Box sx={{ minWidth: 180 }}>
              <Typography variant="subtitle2">
                {v.PLATE_NO} {v.NAME ?? ''}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ my: 0.5 }}>
                <Chip size="small" label={VEHICLE_STATE_LABEL[v.STATE]} sx={{ height: 20, fontSize: 11 }} />
                {v.SPEED !== null && v.SPEED !== undefined && (
                  <Chip size="small" label={`${v.SPEED} km/h`} sx={{ height: 20, fontSize: 11 }} />
                )}
              </Stack>
              <Typography variant="body2">駕駛：{v.DRIVER ?? '未指派'}</Typography>
              <Typography variant="caption" color="text.secondary">
                最後回報 {CasePresenter.time(v.LAST_REPORT_AT)}
              </Typography>
            </Box>
          </Popup>
        </CircleMarker>
      );
    });
  }

  if (layer.type === 'point') {
    return layer.data.map((p) => (
      <CircleMarker
        key={p.ID}
        center={[p.LAT, p.LNG]}
        radius={6}
        pathOptions={{ color: layer.color, fillColor: layer.color, fillOpacity: 0.8 * opacity, weight: 1 }}
      >
        <Popup>
          <Box sx={{ minWidth: 170 }}>
            <Typography variant="subtitle2">{p.ROAD_NAME ?? p.ORDER_NO}</Typography>
            {p.METHOD && <Typography variant="body2">方法：{p.METHOD}</Typography>}
            {p.PCI !== null && p.PCI !== undefined && <Typography variant="body2">PCI {p.PCI}</Typography>}
            {p.FINDING && <Typography variant="caption">{p.FINDING}</Typography>}
          </Box>
        </Popup>
      </CircleMarker>
    ));
  }

  return null;
}
