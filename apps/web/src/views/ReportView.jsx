import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import { reportApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { useRealtime } from '../hooks/useRealtime';
import { CASE_STATUS_LABEL, CRACK_LABEL, NEED_REPAIR_LABEL } from '../config/vocabulary';

const STATE_COLOR = { PENDING: 'default', RUNNING: 'info', DONE: 'success', FAILED: 'error' };
const STATE_LABEL = { PENDING: '排隊中', RUNNING: '產製中', DONE: '完成', FAILED: '失敗' };

/**
 * 報表。
 *
 * 產製是非同步的，所以這頁的重點是「讓等待可被理解」：
 * 送出後立刻看到一筆排隊中的紀錄，完成時由 WebSocket 通知，
 * 而不是讓使用者自己按重新整理猜。
 */
export default function ReportView() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ FORMAT: 'XLSX', STATUS: '', NEED_REPAIR: '', CRACK_TYPE: '', DATE_FROM: '', DATE_TO: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await reportApi.list();
      setRows(res.data ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type !== 'report.done') return;
      setNotice(msg.data.state === 'DONE' ? `報表 #${msg.data.reportId} 產製完成（${msg.data.rowCount} 列）` : `報表 #${msg.data.reportId} 產製失敗`);
      load();
    },
    [load]
  );

  useRealtime({ channels: ['report'], onMessage: handleMessage });

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      const res = await reportApi.create(body);
      setNotice(res.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 刪除報表。
   *
   * 二次確認不是為了防手滑 —— 是因為報表可能已經被寄出去或附在公文上，
   * 刪掉之後那個下載連結就永遠失效了。
   */
  const handleDelete = async (row) => {
    if (!window.confirm(`確定刪除報表 #${row.ID}？產出的檔案會一併從儲存空間移除，無法復原。`)) return;

    try {
      const res = await reportApi.remove(row.ID);
      setNotice(res.message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownload = async (id) => {
    try {
      const res = await reportApi.get(id);
      // 下載網址是短效簽名的，每次都重新取一次，不要把它存在畫面狀態裡
      if (res.data.DOWNLOAD_URL) window.open(res.data.DOWNLOAD_URL, '_blank', 'noopener');
      else setError('報表尚未完成');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          產製報表
        </Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <TextField select size="small" label="格式" value={form.FORMAT} onChange={(e) => setForm({ ...form, FORMAT: e.target.value })} sx={{ minWidth: 160 }}>
            <MenuItem value="XLSX">Excel（明細 + 統計）</MenuItem>
            <MenuItem value="DOCX">Word（公文格式）</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            label="二篩狀態"
            value={form.STATUS}
            onChange={(e) => setForm({ ...form, STATUS: e.target.value })}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(CASE_STATUS_LABEL).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="案件狀態"
            value={form.NEED_REPAIR}
            onChange={(e) => setForm({ ...form, NEED_REPAIR: e.target.value })}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(NEED_REPAIR_LABEL).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="破壞類型"
            value={form.CRACK_TYPE}
            onChange={(e) => setForm({ ...form, CRACK_TYPE: e.target.value })}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(CRACK_LABEL).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {v}
              </MenuItem>
            ))}
          </TextField>

          <TextField size="small" type="date" label="起" InputLabelProps={{ shrink: true }} value={form.DATE_FROM} onChange={(e) => setForm({ ...form, DATE_FROM: e.target.value })} />
          <TextField size="small" type="date" label="迄" InputLabelProps={{ shrink: true }} value={form.DATE_TO} onChange={(e) => setForm({ ...form, DATE_TO: e.target.value })} />

          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate} disabled={busy}>
            {busy ? '送出中…' : '新增報表'}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          相同條件的報表在完成前重複請求會沿用同一筆工作，不會排出第二份。
        </Typography>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>格式</TableCell>
              <TableCell>狀態</TableCell>
              <TableCell align="right">列數</TableCell>
              <TableCell>建立時間</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ID} hover>
                <TableCell sx={{ fontFamily: '"JetBrains Mono", monospace' }}>{r.ID}</TableCell>
                <TableCell>{r.FORMAT === 'XLSX' ? 'Excel' : 'Word'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={STATE_LABEL[r.STATE] ?? r.STATE} color={STATE_COLOR[r.STATE]} variant="outlined" />
                    {r.STATE === 'RUNNING' && <Box sx={{ width: 60 }}><LinearProgress /></Box>}
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {r.ROW_COUNT}
                </TableCell>
                <TableCell>{CasePresenter.time(r.CREATED_AT)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Button size="small" startIcon={<DownloadIcon />} disabled={r.STATE !== 'DONE'} onClick={() => handleDownload(r.ID)}>
                      下載
                    </Button>
                    <Tooltip title={r.STATE === 'RUNNING' ? '產製中無法刪除' : '刪除報表與檔案'}>
                      <span>
                        <IconButton size="small" color="error" disabled={r.STATE === 'RUNNING'} onClick={() => handleDelete(r)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}

            {!rows.length && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                  尚無報表
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
