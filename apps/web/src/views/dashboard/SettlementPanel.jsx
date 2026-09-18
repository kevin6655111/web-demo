import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme
} from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis
} from 'recharts';
import { dashboardApi } from '../../models/api/patrolApi';
import { SettlementPresenter } from '../../presenters/SettlementPresenter';


/**
 * 圓餅的配色。
 *
 * 不沿用 `CRACK_COLOR`：結算的類型欄位是彙總後的六個計數欄
 * (`POTHOLE`/`ALLIGATOR`…)，和判讀模型輸出的破壞類型代碼不是同一組 key。
 * 硬對過去會在新增一種破壞類型時安靜地對錯色。
 */
const SLICE_COLORS = ['error', 'warning', 'info', 'success', 'secondary', 'primary'];

const GROUP_OPTIONS = [
  { value: 'DAY', label: '每日' },
  { value: 'MONTH', label: '每月' },
  { value: 'DISTRICT', label: '行政區' }
];

/**
 * 結算。
 *
 * 這一頁是**請款的依據**，不是看板：契約寫「每公里多少錢」與
 * 「每件多少錢」，而這兩個數字都在這裡。
 *
 * 里程與案件畫在同一張圖上是刻意的 —— 結算爭議幾乎都是
 * 「這個月跑了那麼多公里，怎麼案件這麼少」，
 * 兩條線分開看的話答不了這個問題。
 */
export default function SettlementPanel() {
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

  const [range, setRange] = useState(SettlementPresenter.defaultRange);
  const [groupBy, setGroupBy] = useState('DAY');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await dashboardApi.settlement({ ...range, GROUP_BY: groupBy });
      setData(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  const trend = useMemo(() => SettlementPresenter.trendSeries(data?.CASES), [data]);
  const types = useMemo(() => SettlementPresenter.typeTotals(data?.CASES), [data]);
  const orders = useMemo(() => SettlementPresenter.orderTotals(data?.ORDERS), [data]);

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            type="date"
            label="起"
            value={range.DATE_START}
            onChange={(e) => setRange((r) => ({ ...r, DATE_START: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            type="date"
            label="迄"
            value={range.DATE_END}
            onChange={(e) => setRange((r) => ({ ...r, DATE_END: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            select
            label="彙總方式"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            {GROUP_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ flex: 1 }} />

          <Button size="small" variant="outlined" onClick={load} disabled={loading}>
            {loading ? '查詢中…' : '重新查詢'}
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}

      <Grid container spacing={2}>
        {[
          { label: '總里程', value: `${data?.TOTAL_KM ?? 0} km`, hint: '計價的分母' },
          { label: '案件數', value: data?.TOTAL_CASES ?? 0, hint: '含所有破壞類型' },
          { label: '完工', value: data?.TOTAL_DONE ?? 0, hint: '已驗收的派工單' },
          { label: '逾期', value: orders.overdue, hint: '需要有人動作', alert: orders.overdue > 0 }
        ].map((k) => (
          <Grid item xs={6} md={3} key={k.label}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {k.label}
              </Typography>
              <Typography variant="h5" color={k.alert ? 'error.main' : 'text.primary'} sx={{ my: 0.3 }}>
                {k.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {k.hint}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 2.5, height: 340 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              里程與案件
            </Typography>

            {!trend.length && !loading ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                這個區間沒有結算資料。結算由每日排程產生。
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height="86%">
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={muiTheme.palette.divider} />
                  <XAxis dataKey="key" tick={{ fontSize: 11 }} stroke={muiTheme.palette.text.secondary} />
                  <YAxis yAxisId="km" tick={{ fontSize: 11 }} stroke={muiTheme.palette.text.secondary} />
                  <YAxis
                    yAxisId="cases"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke={muiTheme.palette.text.secondary}
                  />
                  <ReTooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="km" dataKey="mileage" name="里程(km)" fill={muiTheme.palette.primary.main} />
                  <Line
                    yAxisId="cases"
                    type="monotone"
                    dataKey="cases"
                    name="案件"
                    stroke={muiTheme.palette.warning.main}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 2.5, height: 340 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              破壞類型
            </Typography>

            {!types.length ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                這個區間沒有案件
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height="86%">
                <PieChart>
                  <Pie data={types} dataKey="value" nameKey="label" innerRadius={48} outerRadius={78}>
                    {types.map((t, i) => (
                      <Cell key={t.key} fill={muiTheme.palette[SLICE_COLORS[i % SLICE_COLORS.length]].main} />
                    ))}
                  </Pie>
                  <ReTooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          派工進度
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`已派工 ${orders.dispatched}`} variant="outlined" />
          <Chip label={`施工中 ${orders.inProgress}`} variant="outlined" color="info" />
          <Chip label={`已回報 ${orders.reported}`} variant="outlined" color="warning" />
          <Chip label={`已完工 ${orders.done}`} variant="outlined" color="success" />
          <Chip
            label={`逾期 ${orders.overdue}`}
            color={orders.overdue ? 'error' : 'default'}
            variant={orders.overdue ? 'filled' : 'outlined'}
          />
        </Stack>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        讀的是每日結算表而不是即時算：即時算要掃整個區間的軌跡點(每台車每天七千筆)。 所以今天的數字要等當天的結算排程跑完才會出現。
      </Typography>
    </Stack>
  );
}
