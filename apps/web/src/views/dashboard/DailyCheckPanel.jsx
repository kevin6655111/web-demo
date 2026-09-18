import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { dashboardApi } from '../../models/api/patrolApi';
import { SettlementPresenter } from '../../presenters/SettlementPresenter';

/** 預設看昨天：今天的資料還在進來，現在說「這台車今天只上傳三筆」沒有意義 */
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * 每日上傳檢查。
 *
 * 督導早上開的第一個畫面，要回答的只有一句話：
 * **昨天每一台車都有正常上傳嗎**。
 *
 * 所以結論欄(`NOTE`)排在最前面而不是最後面 —— 車號與數字是佐證，
 * 督導真正要的是「哪幾台要處理、要處理什麼」。
 */
export default function DailyCheckPanel() {
  const [date, setDate] = useState(yesterday);
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await dashboardApi.dailyCheck({ DATE: date, ABNORMAL_ONLY: abnormalOnly || undefined });
      setData(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date, abnormalOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = SettlementPresenter.checkSummary(data);

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            type="date"
            label="檢查日期"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Switch size="small" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />
            <Typography variant="body2">只看需要處理的</Typography>
          </Stack>

          <Box sx={{ flex: 1 }} />

          <Button size="small" variant="outlined" onClick={load} disabled={loading}>
            {loading ? '查詢中…' : '重新查詢'}
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {data?.DATE ?? date}
          </Typography>
          <Chip
            size="small"
            label={summary.verdict}
            color={summary.abnormal ? 'error' : summary.total ? 'success' : 'default'}
            variant={summary.abnormal ? 'filled' : 'outlined'}
          />
          <Chip size="small" variant="outlined" label={`案件 ${data?.CASE_TOTAL ?? 0}`} />
          <Chip size="small" variant="outlined" label={`照片缺件 ${data?.IMAGE_MISSING ?? 0}`} />
        </Stack>

        {!summary.total && !loading && (
          <Alert severity="info">
            這一天還沒有檢查資料。檢查由「每日檢查上傳狀態」排程產生，08:45 起每小時跑一次。
          </Alert>
        )}

        {summary.total > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>結論</TableCell>
                  <TableCell>車號</TableCell>
                  <TableCell align="right">案件</TableCell>
                  <TableCell align="right">照片</TableCell>
                  <TableCell align="right">軌跡</TableCell>
                  <TableCell>行政區</TableCell>
                  <TableCell>要做什麼</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {summary.rows.map((r) => (
                  <TableRow key={`${r.CAR}-${r.DISTRICT}-${r.PRJ_ID}`} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.NOTE}
                        color={r.level === 'success' ? 'success' : r.level}
                        variant={r.level === 'success' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: '"JetBrains Mono", monospace' }}>{r.CAR}</TableCell>
                    <TableCell align="right">{r.CASE_COUNT}</TableCell>
                    <TableCell align="right">{r.imageText}</TableCell>
                    <TableCell align="right">{r.trackText}</TableCell>
                    <TableCell>{r.DISTRICT}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color={r.action ? 'text.primary' : 'text.secondary'}>
                        {r.action ?? '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      <Typography variant="caption" color="text.secondary">
        照片是抽驗的：每組最多抽 50 張問物件儲存，再用缺件率推估全體 —— 所以「缺件約 N 張」是估計值，不是精確數字。
        逐筆全驗會讓一次檢查跑上幾分鐘。
      </Typography>
    </Stack>
  );
}
