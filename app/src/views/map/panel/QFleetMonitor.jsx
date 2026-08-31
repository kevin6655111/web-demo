import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import QueryForm from '../../components/query/QueryForm';
import { fleetApi, realtimeApi } from '../../../models/api/patrolApi';
import { VEHICLE_STATE_COLOR, VEHICLE_STATE_LABEL, VEHICLE_TYPE_LABEL } from '../../../styles/theme';
import { useRealtime } from '../../../hooks/useRealtime';
import { useMapLayers } from '../../../context/MapContext';
import { fleetQueryFields } from '../../../config/queryFields';
import { useQueryOptions } from '../../../hooks/useQueryOptions';

const OWN_FIELDS = [
  { key: 'PLATE_NO', label: '車牌', placeholder: 'DEMO-001' },
  { key: 'VEHICLE_TYPE', label: '用途', type: 'multi', options: Object.entries(VEHICLE_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
  { key: 'STATE', label: '狀態', type: 'multi', options: Object.entries(VEHICLE_STATE_LABEL).map(([value, label]) => ({ value, label })) }
];

/**
 * 車隊管理。
 *
 * 掛載時取「現在的位置」，之後靠 WebSocket 收「位置的變化」——
 * 少了任何一邊畫面都會不完整：只有 WebSocket 的話，
 * 剛打開時地圖上是空的，要等某台車回報才會有第一個點。
 */
export default function QFleetMonitor() {
  const { registerLayer } = useMapLayers();
  const queryOptions = useQueryOptions();
  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [live, setLive] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async (query) => {
    try {
      const params = { ...query };
      for (const [k, v] of Object.entries(params)) if (Array.isArray(v)) params[k] = v.join(',');

      const [v, f] = await Promise.all([fleetApi.vehicles(params), realtimeApi.fleet().catch(() => ({ data: [] }))]);
      setVehicles(v.data ?? []);

      // Redis 的即時位置以負數 uid 代表車輛，與人員區分
      const map = {};
      for (const p of f.data ?? []) if (p.uid < 0) map[-p.uid] = p;
      setLive(map);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load(applied);
    // 車輛狀態變化不像案件那麼即時，30 秒重取一次補足 WebSocket 漏掉的
    const timer = setInterval(() => load(applied), 30000);
    return () => clearInterval(timer);
  }, [applied, load]);

  const { connected } = useRealtime({
    channels: ['fleet'],
    onMessage: useCallback((msg) => {
      if (msg.type !== 'fleet.moved') return;
      const id = msg.data.uid < 0 ? -msg.data.uid : null;
      if (id) setLive((prev) => ({ ...prev, [id]: msg.data }));
    }, [])
  });

  /** 即時位置優先於資料庫的最後位置 */
  const points = useMemo(
    () =>
      vehicles
        .map((v) => {
          const p = live[v.ID];
          const lng = p?.lng ?? v.LNG;
          const lat = p?.lat ?? v.LAT;
          return lng && lat ? { ...v, LNG: lng, LAT: lat, SPEED: p?.speedKph ?? null, LIVE: !!p } : null;
        })
        .filter(Boolean),
    [vehicles, live]
  );

  useEffect(() => {
    registerLayer('fleet', {
      group: 'fleet',
      type: 'vehicle',
      label: '車輛位置',
      color: 'var(--c-success)',
      count: points.length,
      data: points,
      order: 40, // 車輛畫在最上層：調度時要能直接點到
      bounds: () => points.map((p) => [p.LAT, p.LNG])
    });
  }, [points, registerLayer]);

  const online = vehicles.filter((v) => v.STATE === 'ONLINE').length;

  // 空間條件與其他圖台面板同一份；車牌與車輛狀態是這個面板專屬的
  const fields = useMemo(() => [...fleetQueryFields(queryOptions), ...OWN_FIELDS], [queryOptions]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={() => setApplied(form)}
        onReset={() => {
          setForm({});
          setApplied({});
        }}
        dense
      />

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            車隊 {vehicles.length} 台
          </Typography>
          <Chip size="small" variant="outlined" color={connected ? 'success' : 'default'} label={connected ? '即時' : '連線中'} />
        </Stack>

        <Typography variant="caption" color="text.secondary">
          在線 {online} 台 · 離線 {vehicles.length - online} 台
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1} sx={{ maxHeight: 260, overflowY: 'auto' }}>
          {vehicles.map((v) => (
            <Box key={v.ID} sx={{ p: 1.2, borderRadius: 2, border: (t) => `1px solid ${t.palette.divider}` }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: VEHICLE_STATE_COLOR[v.STATE], flexShrink: 0 }} />
                <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
                  {v.PLATE_NO}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {VEHICLE_TYPE_LABEL[v.VEHICLE_TYPE]}
                </Typography>
              </Stack>

              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.3 }}>
                {v.DRIVER ?? '未指派'} · 今日 {v.TODAY_KM} km
                {v.SILENT_MIN !== null && ` · ${v.SILENT_MIN} 分前回報`}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
