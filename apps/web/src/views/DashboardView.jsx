import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, Grid, LinearProgress, Paper, Stack, Typography, useTheme } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Area,
  AreaChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis
} from 'recharts';
import { dashboardApi } from '../models/api/patrolApi';
import { DashboardPresenter } from '../presenters/DashboardPresenter';
import { useRealtime } from '../hooks/useRealtime';
import KpiCard from './components/KpiCard';
import LiveFeed from './components/LiveFeed';

const CHANNELS = ['case', 'workorder', 'presence'];

/** 儀表板 */
export default function DashboardView() {
  // Recharts 不吃 MUI 的 sx，只認原生 CSS —— 所以顏色要自己從主題取出來，
  // 否則淺色模式下圖表提示框會是一塊深色
  const muiTheme = useTheme();
  const chartTooltipStyle = useMemo(
    () => ({
      background: muiTheme.palette.background.paper,
      border: `1px solid ${muiTheme.palette.divider}`,
      color: muiTheme.palette.text.primary,
      borderRadius: 10,
      fontSize: 13
    }),
    [muiTheme]
  );

  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await dashboardApi.overview();
      setData(res.data);
      setRecent(res.data.RECENT ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    // 後端已經快取 60 秒，前端也用同樣的節奏拉，不必更頻繁
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'case.created') {
      // 新案件直接插進清單，不重打整包儀表板 —— 那是六個聚合查詢
      setRecent((prev) => DashboardPresenter.mergeIncoming(prev, msg.data));
    }
    if (msg.type === 'case.enriched') {
      setRecent((prev) => prev.map((c) => (c.ID === msg.data.caseId ? { ...c, ROAD_NAME: msg.data.roadName } : c)));
    }
    if (msg.type === 'presence.joined' || msg.type === 'presence.left') {
      setOnline((n) => Math.max(0, n + (msg.type === 'presence.joined' ? 1 : -1)));
    }
  }, []);

  const { connected } = useRealtime({ channels: CHANNELS, onMessage: handleMessage });

  const kpis = useMemo(() => DashboardPresenter.kpiCards(data?.KPI), [data]);
  const trend = useMemo(() => DashboardPresenter.trendSeries(data?.TREND), [data]);
  const types = useMemo(() => DashboardPresenter.typeSeries(data?.BY_TYPE, muiTheme.palette.mode), [data, muiTheme.palette.mode]);
  const hotspots = useMemo(() => DashboardPresenter.hotspots(data?.HOTSPOTS), [data]);
  const overdue = useMemo(() => DashboardPresenter.overdue(data?.OVERDUE), [data]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <LinearProgress />;

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2.5}>
        {kpis.map((k) => (
          <Grid item xs={6} md={3} key={k.key}>
            <KpiCard {...k} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 2.5, height: 340 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>
                近 14 日案件趨勢
              </Typography>
              <Chip size="small" variant="outlined" label={`線上 ${online} 人`} />
            </Stack>

            <ResponsiveContainer width="100%" height="88%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={muiTheme.palette.primary.main} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={muiTheme.palette.primary.main} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gRepaired" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={muiTheme.palette.success.main} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={muiTheme.palette.success.main} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke={muiTheme.palette.text.secondary} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={muiTheme.palette.text.secondary} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReTooltip
                  contentStyle={chartTooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="案件" stroke={muiTheme.palette.primary.main} strokeWidth={2} fill="url(#gTotal)" />
                <Area type="monotone" dataKey="完修" stroke={muiTheme.palette.success.main} strokeWidth={2} fill="url(#gRepaired)" />
              </AreaChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Box sx={{ height: 340 }}>
            <LiveFeed rows={recent} connected={connected} />
          </Box>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, height: 320 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              破壞類型分布
            </Typography>
            <ResponsiveContainer width="100%" height="86%">
              <PieChart>
                <Pie data={types} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={3} stroke="none">
                  {types.map((t) => (
                    <Cell key={t.name} fill={t.fill} />
                  ))}
                </Pie>
                <ReTooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v, n, p) => [`${v} 件 / ${p.payload.area ?? 0} m²`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, height: 320, overflow: 'hidden' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              熱區路段
            </Typography>
            <Stack spacing={1.6} sx={{ overflowY: 'auto', maxHeight: 240 }}>
              {hotspots.map((h) => (
                <Box key={h.ROAD}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
                    <Typography variant="body2">{h.ROAD}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {h.COUNT} 件 · 待處理 {h.PENDING}
                    </Typography>
                  </Stack>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'action.selected' }}>
                    <Box
                      sx={{
                        height: '100%',
                        width: `${h.RATIO * 100}%`,
                        borderRadius: 3,
                        background: (t) => `linear-gradient(90deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`,
                        transition: 'width .6s ease'
                      }}
                    />
                  </Box>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2.5, height: 320, overflow: 'hidden' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <WarningAmberIcon sx={{ color: 'warning.main', fontSize: 20 }} />
              <Typography variant="h6">逾期未完工</Typography>
            </Stack>

            <Stack spacing={1.2} sx={{ overflowY: 'auto', maxHeight: 240 }}>
              {overdue.map((o) => (
                <Stack
                  key={o.ID}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ p: 1.2, borderRadius: 2, border: '1px solid', borderColor: o.SEVERE ? 'error.main' : 'divider' }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {o.ROAD ?? '未定位'} · {o.ASSIGNEE ?? '未指派'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {o.ORDER_NO}
                    </Typography>
                  </Box>
                  <Chip size="small" label={o.OVERDUE_TEXT} color={o.SEVERE ? 'error' : 'warning'} variant="outlined" />
                </Stack>
              ))}

              {!overdue.length && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  沒有逾期的派工單
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
