import { useCallback, useEffect, useMemo, useState } from 'react';
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
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import DataTable, { StatusChip } from './components/query/DataTable';
import QueryForm from './components/query/QueryForm';
import ConfirmDialog from './components/dialog/ConfirmDialog';
import { authApi, fleetApi, projectApi, reportApi, surveyApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { ReportPresenter } from '../presenters/ReportPresenter';
import { useRealtime } from '../hooks/useRealtime';
import { CRACK_LABEL, MAINTAIN_LABEL } from '../config/vocabulary';
import { useUser } from '../context/UserContext';

/**
 * 報表。
 *
 * 十一種報表共用這一個畫面：選了種類之後，條件欄位才依那一種需要的參數長出來。
 * 把所有條件一次攤開的話，使用者要在十幾個欄位裡找出「月報要填哪一個」。
 *
 * 產製是非同步的，所以這頁的重點是**讓等待可被理解**：
 * 送出後立刻看到一筆排隊中的紀錄，完成時由 WebSocket 通知，
 * 而不是讓使用者自己按重新整理猜。
 */
export default function ReportView() {
  const { can } = useUser();
  const [kinds, setKinds] = useState([]);
  const [kind, setKind] = useState('');
  const [format, setFormat] = useState('XLSX');
  const [params, setParams] = useState({});
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({ projects: [], vehicles: [], users: [], orders: [], districts: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (kindFilter) => {
    try {
      const res = await reportApi.list(kindFilter ? { KIND: kindFilter } : undefined);
      setRows(res.data ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // 種類與選項各抓一次；選項是共用的，不會因為換報表種類重抓
  useEffect(() => {
    (async () => {
      try {
        const [kindRes, projects, vehicles, users, orders, districts] = await Promise.all([
          reportApi.kinds(),
          projectApi.list().catch(() => ({ data: [] })),
          fleetApi.vehicles().catch(() => ({ data: [] })),
          authApi.orgUsers().catch(() => ({ data: [] })),
          surveyApi.orders({}).catch(() => ({ data: [] })),
          projectApi.areas().catch(() => ({ data: [] }))
        ]);

        const list = kindRes.data ?? [];
        setKinds(list);
        setKind(list[0]?.KEY ?? '');
        setFormat(list[0]?.FORMATS?.[0] ?? 'XLSX');
        setOptions({
          projects: projects.data ?? [],
          vehicles: vehicles.data ?? [],
          users: users.data ?? [],
          orders: orders.data ?? [],
          districts: districts.data ?? []
        });

        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type !== 'report.done') return;

      setNotice(
        msg.data.state === 'DONE'
          ? `報表 #${msg.data.reportId} 產製完成（${msg.data.rowCount} 列）`
          : `報表 #${msg.data.reportId} 產製失敗`
      );
      load(filter);
    },
    [load, filter]
  );

  useRealtime({ channels: ['report'], onMessage: handleMessage });

  const current = useMemo(() => kinds.find((k) => k.KEY === kind), [kinds, kind]);

  const fields = useMemo(
    () =>
      ReportPresenter.paramFields(current?.PARAMS ?? [], {
        ...options,
        crackTypes: Object.entries(CRACK_LABEL),
        levels: Object.entries(MAINTAIN_LABEL)
      }),
    [current, options]
  );

  const changeKind = (next) => {
    setKind(next);
    setParams({});

    // 換種類時格式要跟著收斂：坑洞報表只有 Excel，留著 Word 會在送出時才被擋
    const allowed = kinds.find((k) => k.KEY === next)?.FORMATS ?? ['XLSX'];
    if (!allowed.includes(format)) setFormat(allowed[0]);
  };

  const create = async () => {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const body = { KIND: kind, FORMAT: format };
      for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) body[k] = v;

      const res = await reportApi.create(body);
      setNotice(res.message);
      await load(filter);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (id) => {
    try {
      const res = await reportApi.get(id);
      // 下載網址是短效簽名的，每次都重新取一次，不要把它存在畫面狀態裡
      if (res.data.DOWNLOAD_URL) window.open(res.data.DOWNLOAD_URL, '_blank', 'noopener');
      else setError('報表尚未完成');
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (row) => {
    try {
      const res = await reportApi.remove(row.ID);
      setNotice(res.message);
      setConfirm(null);
      await load(filter);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <LinearProgress />;

  const grouped = kinds.reduce((acc, k) => {
    (acc[k.GROUP] ??= []).push(k);
    return acc;
  }, {});

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          產製報表
        </Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
          <TextField
            select
            size="small"
            label="報表種類"
            value={kind}
            onChange={(e) => changeKind(e.target.value)}
            sx={{ minWidth: 260 }}
          >
            {Object.entries(grouped).flatMap(([group, list]) => [
              <MenuItem key={`h-${group}`} disabled sx={{ opacity: 0.7, fontSize: 12 }}>
                {ReportPresenter.groupLabel(group)}
              </MenuItem>,
              ...list.map((k) => (
                <MenuItem key={k.KEY} value={k.KEY} sx={{ pl: 3 }}>
                  {k.NAME}
                </MenuItem>
              ))
            ])}
          </TextField>

          <TextField
            select
            size="small"
            label="格式"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            sx={{ minWidth: 180 }}
            helperText={current?.FORMATS?.length === 1 ? '這種報表只提供 Excel' : ' '}
          >
            {(current?.FORMATS ?? ['XLSX']).map((f) => (
              <MenuItem key={f} value={f}>
                {f === 'XLSX' ? 'Excel（明細 + 統計）' : 'Word（公文格式）'}
              </MenuItem>
            ))}
          </TextField>

          <Button variant="contained" startIcon={<AddIcon />} onClick={create} disabled={busy || !can('REPORT.CREATE')}>
            {busy ? '送出中…' : '產製報表'}
          </Button>
        </Stack>

        {fields.length > 0 ? (
          <QueryForm fields={fields} value={params} onChange={setParams} onSearch={create} onReset={() => setParams({})} dense />
        ) : (
          <Typography variant="body2" color="text.secondary">
            這種報表不需要額外條件。
          </Typography>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          相同種類與條件的報表在完成前重複請求會沿用同一筆工作，不會排出第二份。
        </Typography>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}

      <QueryForm
        fields={[
          {
            key: 'KIND',
            label: '只看某一種',
            type: 'select',
            width: 240,
            options: kinds.map((k) => ({ value: k.KEY, label: k.NAME }))
          }
        ]}
        value={{ KIND: filter }}
        onChange={(v) => setFilter(v.KIND ?? '')}
        onSearch={() => load(filter)}
        onReset={() => {
          setFilter('');
          load('');
        }}
        dense
      />

      <DataTable
        columns={[
          { key: 'ID', label: '#', mono: true },
          { key: 'TITLE', label: '報表' },
          { key: 'FORMAT', label: '格式', render: (v) => (v === 'XLSX' ? 'Excel' : 'Word') },
          {
            key: 'STATE',
            label: '狀態',
            render: (v, row) => (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  variant="outlined"
                  label={ReportPresenter.stateLabel(v)}
                  color={ReportPresenter.stateColor(v)}
                />
                {v === 'RUNNING' && (
                  <Box sx={{ width: 56 }}>
                    <LinearProgress />
                  </Box>
                )}
                {v === 'FAILED' && row.ERROR && (
                  <Tooltip title={row.ERROR}>
                    <Typography variant="caption" color="error" sx={{ cursor: 'help' }}>
                      原因
                    </Typography>
                  </Tooltip>
                )}
              </Stack>
            )
          },
          { key: 'ROW_COUNT', label: '列數', type: 'number', digits: 0 },
          {
            key: 'PARAMS',
            label: '條件',
            wrap: true,
            render: (v) => (
              <Typography variant="caption" color="text.secondary">
                {ReportPresenter.paramSummary(v)}
              </Typography>
            )
          },
          { key: 'REQUESTER', label: '產製者' },
          { key: 'CREATED_AT', label: '建立時間', render: (v) => CasePresenter.time(v) },
          {
            key: 'ACTION',
            label: '',
            align: 'right',
            render: (_, row) => (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                <Button
                  size="small"
                  startIcon={<DownloadIcon />}
                  disabled={row.STATE !== 'DONE'}
                  onClick={(e) => {
                    e.stopPropagation();
                    download(row.ID);
                  }}
                >
                  下載
                </Button>
                <Tooltip title={row.STATE === 'RUNNING' ? '產製中無法刪除' : '刪除報表與檔案'}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={row.STATE === 'RUNNING' || !can('REPORT.CREATE')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirm({
                          title: '刪除報表',
                          // 二次確認不是為了防手滑 —— 報表可能已經附在公文上，
                          // 刪掉之後那個下載連結就永遠失效了
                          message: `確定刪除報表 #${row.ID}（${row.TITLE}）？\n產出的檔案會一併從儲存空間移除，無法復原。`,
                          danger: true,
                          onConfirm: () => remove(row)
                        });
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            )
          }
        ]}
        rows={rows}
        emptyText="尚無報表"
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger={confirm?.danger}
        confirmLabel="刪除"
        onConfirm={confirm?.onConfirm}
        onClose={() => setConfirm(null)}
      />
    </Stack>
  );
}
