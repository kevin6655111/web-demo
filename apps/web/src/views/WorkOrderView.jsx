import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import TableRowsIcon from '@mui/icons-material/TableRows';
import QueryForm from './components/query/QueryForm';
import DataTable, { StatusChip } from './components/query/DataTable';
import ImageCell from './components/query/ImageCell';
import WorkOrderDialog from './components/dialog/WorkOrderDialog';
import { authApi, workOrderApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { toQueryParams, workOrderQueryFields } from '../config/queryFields';
import { useQueryOptions } from '../hooks/useQueryOptions';
import { MATERIAL_LABEL, WORK_ORDER_COLOR, WORK_ORDER_LABEL } from '../config/vocabulary';
import { useRealtime } from '../hooks/useRealtime';

/**
 * 看板的欄位。
 *
 * 不含「已刪除」—— 看板要回答的是「哪一堆卡住了」，
 * 刪掉的單不在流程上，給它一整欄只會把四欄擠成五欄。
 * 要找回刪掉的單，用表格檢視加狀態條件。
 */
const COLUMNS = Object.entries(WORK_ORDER_LABEL)
  .filter(([value]) => Number(value) >= 0)
  .map(([value, label]) => ({ status: Number(value), label, color: WORK_ORDER_COLOR[value] }));

/**
 * 派工管理。
 *
 * 看板與表格兩種檢視：看板回答「哪一堆卡住了」——那是一眼看欄位高度就知道的事；
 * 表格回答「這批單的細節是什麼」——驗收與請款時看的是後者。
 * 做成切換是因為同一個人在一天裡兩種都會用到。
 */
export default function WorkOrderView() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [mode, setMode] = useState('board');
  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const queryOptions = useQueryOptions();
  const [workers, setWorkers] = useState([]);

  useEffect(() => {
    authApi
      .orgUsers()
      .then((res) => setWorkers((res.data ?? []).filter((u) => u.ACTIVE).map((u) => ({ ID: u.ID, NAME: u.USER_NAME }))))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 看板要一次看到所有欄位，所以不分頁；表格照使用者選的頁大小
      const params =
        mode === 'board'
          ? { SIZE: 200, ...toQueryParams(applied) }
          : { PAGE: page + 1, SIZE: size, ...toQueryParams(applied) };

      const res = await workOrderApi.list(params);
      setRows(res.data?.ROWS ?? []);
      setTotal(res.data?.TOTAL ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mode, applied, page, size]);

  useEffect(() => {
    load();
  }, [load]);

  // 派工狀態變動時重新載入：這種變動不頻繁，整批重載比逐筆修補簡單且不會錯
  const handleMessage = useCallback(
    (msg) => {
      if (msg.type === 'workorder.changed') load();
    },
    [load]
  );

  const { connected } = useRealtime({ channels: ['workorder'], onMessage: handleMessage });

  const fields = useMemo(() => workOrderQueryFields({ ...queryOptions, workers }), [queryOptions, workers]);

  const grouped = useMemo(() => {
    const acc = Object.fromEntries(COLUMNS.map((c) => [c.status, []]));
    for (const r of rows) acc[r.STATUS]?.push(r);
    return acc;
  }, [rows]);

  const columns = useMemo(
    () => [
      {
        key: 'THUMBNAILS',
        label: '照片',
        // 驗收要看的是「修之前 / 修完」的對照，一眼判斷比讀欄位快
        render: (v) => <ImageCell images={v ?? []} />
      },
      { key: 'CASE_NUM', label: '派工單號', mono: true },
      { key: 'TYPE', label: '類型', render: (v) => CasePresenter.workOrderTypeLabel(v) },
      {
        key: 'STATUS',
        label: '狀態',
        render: (v) => (
          <StatusChip label={CasePresenter.workOrderLabel(v)} color={WORK_ORDER_COLOR[v] ?? 'var(--c-neutral)'} />
        )
      },
      { key: 'DISTRICT', label: '行政區' },
      { key: 'ADDRESS', label: '施工地址' },
      // 一張單可以派多人；沒指派時後端回「未指定人員」，這裡不必再補一次空狀態
      { key: 'WORKERS', label: '施工人員', render: (v) => (v ?? []).map((x) => x.NAME).join('、') || '—' },
      { key: 'WORK_UNIT', label: '施工單位', render: (v) => CasePresenter.workUnitLabel(v) },
      { key: 'DISPATCHER', label: '派工人員' },
      { key: 'DISPATCH_DATE', label: '派工日' },
      {
        key: 'DUE_DATE',
        label: '限期',
        render: (v, row) =>
          v ? <StatusChip label={v} color={row.OVERDUE ? 'var(--c-error)' : 'var(--c-neutral)'} /> : '—'
      },
      { key: 'WORK_END_DATE', label: '完工日' },
      { key: 'MATERIAL', label: '材料', render: (v) => MATERIAL_LABEL[v] ?? v ?? '—' },
      { key: 'WORK_LENGTH', label: '長 m', type: 'number', digits: 2 },
      { key: 'WORK_WIDTH', label: '寬 m', type: 'number', digits: 2 },
      {
        key: 'MISSING_IMAGE_COUNT',
        label: '缺件',
        render: (v) => (v > 0 ? <StatusChip label={`缺 ${v}`} color="#fbbf24" /> : '—')
      },
      { key: 'PRJ_ID', label: '標案', mono: true }
    ],
    []
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          共 {total || rows.length} 張派工單
        </Typography>

        <Chip
          size="small"
          variant="outlined"
          color={connected ? 'success' : 'default'}
          label={connected ? '即時更新中' : '連線中…'}
        />

        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="board" aria-label="看板檢視">
            <ViewKanbanIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="table" aria-label="表格檢視">
            <TableRowsIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={() => {
          setPage(0);
          setApplied(form);
        }}
        onReset={() => {
          setForm({});
          setApplied({});
          setPage(0);
        }}
      />

      {loading && <LinearProgress />}

      {mode === 'board' && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(220px, 1fr))' },
            gap: 2,
            alignItems: 'start'
          }}
        >
          {COLUMNS.map((col) => (
            <Paper key={col.status} sx={{ p: 1.5, minHeight: 200 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, px: 0.5 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: col.color }} />
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {col.label}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace', color: col.color }}>
                  {grouped[col.status]?.length ?? 0}
                </Typography>
              </Stack>

              <Stack spacing={1} sx={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
                {(grouped[col.status] ?? []).map((w) => (
                  <Box
                    key={w.ID}
                    onClick={() => setActive(w)}
                    sx={{
                      p: 1.3,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: w.OVERDUE ? 'error.main' : 'divider',
                      bgcolor: 'action.hover',
                      cursor: 'pointer',
                      transition: 'border-color .15s, transform .15s',
                      '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' }
                    }}
                  >
                    <Stack direction="row" spacing={1}>
                      {w.THUMBNAILS?.length > 0 && <ImageCell images={w.THUMBNAILS} size={40} />}

                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: '"JetBrains Mono", monospace', color: 'text.secondary' }}
                        >
                          {w.CASE_NUM}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.3, fontWeight: 500 }} noWrap>
                          {w.ADDRESS ?? '未定位'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {CasePresenter.workOrderTypeLabel(w.TYPE)} ·{' '}
                          {(w.WORKERS ?? []).map((x) => x.NAME).join('、') || '未指派'}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.8 }} flexWrap="wrap" useFlexGap>
                      {w.DUE_DATE && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={w.OVERDUE ? 'error' : 'default'}
                          label={`期限 ${w.DUE_DATE}`}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      )}
                      {/* 缺件標在卡片上：驗收前才發現缺照片，那張單要再跑一輪 */}
                      {w.MISSING_IMAGE_COUNT > 0 && (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label={`缺 ${w.MISSING_IMAGE_COUNT} 照`}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      )}
                    </Stack>
                  </Box>
                ))}

                {!(grouped[col.status] ?? []).length && (
                  <Typography variant="caption" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    無
                  </Typography>
                )}
              </Stack>
            </Paper>
          ))}
        </Box>
      )}

      {mode === 'table' && (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          total={total}
          page={page}
          size={size}
          onPageChange={setPage}
          onSizeChange={(s) => {
            setSize(s);
            setPage(0);
          }}
          onRowClick={setActive}
          emptyText="查無符合條件的派工單"
        />
      )}

      <WorkOrderDialog
        open={!!active}
        row={active}
        onClose={() => setActive(null)}
        onSaved={() => {
          setActive(null);
          load();
        }}
      />
    </Stack>
  );
}
