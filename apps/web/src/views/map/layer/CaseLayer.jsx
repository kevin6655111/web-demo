import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { DEGREE_COLOR } from '../../../config/vocabulary';

/**
 * 案件圖層，三種渲染模式。
 *
 * 為什麼一個圖層要三種畫法：資料量不同時，看得懂的畫法就不同。
 *   點位  幾百筆以下，要看個別案件的類型與狀態
 *   聚合  上千筆時點會疊成一片，聚合才看得出「哪一區多」
 *   熱區  上萬筆時連聚合都太密，熱區看的是分布而不是個別案件
 *
 * 這三種在 web_server 是 IconLayer / ClusterGroupLayer / HeatmapLayer，
 * 這裡用 Leaflet 對應實作，行為與分組概念一致。
 */

/** 聚合圓的大小與顏色跟著數量走：一眼看出哪一團最大 */
function clusterStyle(count) {
  if (count >= 100) return { size: 46, bg: 'rgba(248,113,113,0.85)', ring: 'rgba(248,113,113,0.35)' };
  if (count >= 30) return { size: 40, bg: 'rgba(251,191,36,0.85)', ring: 'rgba(251,191,36,0.35)' };
  return { size: 34, bg: 'rgba(56,189,248,0.85)', ring: 'rgba(56,189,248,0.3)' };
}

/** 用 divIcon 畫聚合圓：內圓 + 外環 + 數量，對應 web_server 的 inner/outer/text 三層 */
function clusterIcon(count) {
  const { size, bg, ring } = clusterStyle(count);

  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};box-shadow:0 0 0 ${Math.round(size / 5)}px ${ring};
      display:flex;align-items:center;justify-content:center;
      color:#0b1220;font-weight:700;font-size:${count >= 1000 ? 11 : 13}px;
      font-family:'JetBrains Mono',monospace;
    ">${count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</div>`,
    className: 'case-cluster',
    iconSize: [size, size]
  });
}

/** 熱區：leaflet.heat 是命令式的，包成元件由 React 控制生命週期 */
function HeatLayer({ points, radius = 25 }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return undefined;

    let layer;
    let cancelled = false;

    // 動態載入：熱區不是每個畫面都用，沒必要進首屏 bundle
    import('leaflet.heat').then(() => {
      if (cancelled) return;

      layer = L.heatLayer(
        points.map((p) => [p.lat, p.lng, p.weight ?? 1]),
        {
          radius,
          blur: 18,
          maxZoom: 17,
          // 色階與狀態色系一致：藍→黃→紅，不需要圖例也看得懂
          gradient: { 0.2: '#38bdf8', 0.5: '#fbbf24', 0.8: '#fb923c', 1: '#f87171' }
        }
      ).addTo(map);
    });

    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [points, radius, map]);

  return null;
}

export default function CaseLayer({ features, mode = 'point', onSelect }) {
  const map = useMap();
  const [bounds, setBounds] = useState(null);
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    moveend: () => {
      setBounds(map.getBounds());
      setZoom(map.getZoom());
    }
  });

  useEffect(() => {
    setBounds(map.getBounds());
  }, [map]);

  const index = useMemo(() => {
    if (mode !== 'cluster') return null;

    // radius 60 是試出來的：太小會留下一堆兩三個點的小簇，太大則整個市區變成一個球
    const sc = new Supercluster({ radius: 60, maxZoom: 17 });
    sc.load(
      features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { ...f.properties, cluster: false }
      }))
    );

    return sc;
  }, [features, mode]);

  const clusters = useMemo(() => {
    if (!index || !bounds) return [];

    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    return index.getClusters(bbox, Math.round(zoom));
  }, [index, bounds, zoom]);

  const heatPoints = useMemo(
    () =>
      mode === 'heat'
        ? features.map((f) => ({
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            // 未處理的案件權重加倍：熱區要凸顯的是「還沒解決的問題」
            weight: f.properties.status === 'NEW' || f.properties.status === 'REJECTED' ? 2 : 1
          }))
        : [],
    [features, mode]
  );

  if (mode === 'heat') return <HeatLayer points={heatPoints} />;

  if (mode === 'cluster') {
    return clusters.map((c) => {
      const [lng, lat] = c.geometry.coordinates;

      if (c.properties.cluster) {
        return (
          <Marker
            key={`cluster-${c.id}`}
            position={[lat, lng]}
            icon={clusterIcon(c.properties.point_count)}
            eventHandlers={{
              // 點聚合圓就展開到「這一簇會散開」的縮放層級，比使用者自己滾滑鼠快
              click: () => map.flyTo([lat, lng], Math.min(index.getClusterExpansionZoom(c.id), 18), { duration: 0.6 })
            }}
          />
        );
      }

      return <CasePoint key={c.properties.id} feature={c} onSelect={onSelect} />;
    });
  }

  return features.map((f) => <CasePoint key={f.properties.id} feature={f} onSelect={onSelect} />);
}

/** 單一案件點位：狀態決定顏色、嚴重程度決定大小 */
function CasePoint({ feature, onSelect }) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  // 顏色跟著修繕狀態：地圖上要一眼看出「哪些還沒修」
  const color = CasePresenter.needRepairColor(p.needRepair);
  const radius = p.isNew ? 9 : p.severity === 'HIGH' ? 8 : p.severity === 'LOW' ? 5 : 6;

  return (
    <CircleMarker
      center={[lat, lng]}
      radius={radius}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: 0.78,
        // 高嚴重度加粗外框：縮小地圖時仍然看得出來
        weight: p.isNew ? 3 : p.degree === 'A' ? 2.5 : 1
      }}
      eventHandlers={onSelect ? { click: () => onSelect(p) } : undefined}
    >
      <Popup>
        <Box sx={{ minWidth: 190 }}>
          <Typography variant="subtitle2">{CasePresenter.crackLabel(p.crackType)}</Typography>
          <Typography variant="caption" component="div" color="text.secondary">
            {p.caseNum ?? p.externalId}
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ my: 0.6 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              variant="outlined"
              label={CasePresenter.needRepairLabel(p.needRepair)}
              sx={{ height: 20, fontSize: 11, borderColor: color }}
            />
            {p.degree && (
              <Chip
                size="small"
                variant="outlined"
                label={`程度 ${CasePresenter.degreeLabel(p.degree)}`}
                sx={{ height: 20, fontSize: 11, borderColor: DEGREE_COLOR[p.degree] }}
              />
            )}
            {p.area !== undefined && <Chip size="small" label={`${Number(p.area).toFixed(2)} m²`} sx={{ height: 20, fontSize: 11 }} />}
          </Stack>

          <Typography variant="body2">{p.roadName ?? p.address ?? '定位中…'}</Typography>
          {p.detectedAt && (
            <Typography variant="caption" color="text.secondary">
              {CasePresenter.time(p.detectedAt)}
            </Typography>
          )}
        </Box>
      </Popup>
    </CircleMarker>
  );
}
