import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, LinearProgress, Snackbar, Stack, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import VisibilityIcon from '@mui/icons-material/Visibility';
import QueryForm from './components/query/QueryForm';
import DataTable, { StatusChip } from './components/query/DataTable';
import ImageCell from './components/query/ImageCell';
import MaintenanceDialog from './components/dialog/MaintenanceDialog';
import DispatchDialog from './components/dialog/DispatchDialog';
import { authApi, maintenanceApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { maintenanceQueryFields, toQueryParams } from '../config/queryFields';
import { useQueryOptions } from '../hooks/useQueryOptions';
import { MAINTENANCE_COLOR, WORK_ORDER_COLOR } from '../config/vocabulary';
import { useRealtime } from '../hooks/useRealtime';
import { useUser } from '../context/UserContext';

/** 復原的動作碼；與派工單共用同一組，前端不必記兩套 */
const RESTORE = 8;

/**
 * 巡查單管理。
 *
 * **批次操作是主要的互動方式**：一趟巡查會開十幾張單，
 * 承辦要做的事是「把這一批轉成觀察中」而不是逐張點開。
 * 所以列表有勾選欄，動作列在表格上方。
 *
 * 不能改的那幾筆會被後端跳過並附上原因（例如派工單還在），
 * 訊息以換行分隔，這裡用 `pre-line` 原樣顯示 —— 那是使用者唯一能知道
 * 「為什麼那三筆沒動」的地方。
 */
export default function MaintenanceView() {
  const { can } = useUser();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState(null);
  const [dispatchRow, setDispatchRow] = useState(null);
  // 用 Set 而不是陣列：勾選狀態要對每一列查一次，
  // 陣列的 includes 是 O(n)，整張表就變成 O(n²) —— 200 列全選時是四萬次比對
  const [selected, setSelected] = useState(() => new Set());
  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [inspectors, setInspectors] = useState([]);
  const queryOptions = useQueryOptions();

  useEffect(() => {
    authApi
      .orgUsers()
      .then((res) => setInspectors((res.data ?? []).filter((u) => u.ACTIVE).map((u) => ({ ID: u.ID, NAME: u.USER_NAME }))))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.list({ PAGE: page + 1, SIZE: size, ...toQueryParams(applied) });
      const next = res.data?.ROWS ?? [];

      setRows(next);
      setTotal(res.data?.TOTAL ?? 0);

      // 重載後只留下「還在這一頁」的勾選。
      //
      // 全部清掉的話，別人的一次改動就會把你正在勾的那十幾張清空 ——
      // 而這一頁是即時的，別人隨時在改。反過來全部留著也不行：
      // 換頁或改條件之後，那些 id 已經不在畫面上，使用者會對看不到的東西下指令。
      const visible = new Set(next.map((r) => r.ID));
      setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applied, page, size]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type === 'maintenance.changed') load();
    },
    [load]
  );

  const { connected } = useRealtime({ channels: ['maintenance'], onMessage: handleMessage });

  const fields = useMemo(() => maintenanceQueryFields({ ...queryOptions, inspectors }), [queryOptions, inspectors]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  /** 批次動作；訊息一律照後端回的顯示 —— 被跳過的原因只有後端知道 */
  const batch = async (status) => {
    if (!selected.size) return;

    try {
      const res = await maintenanceApi.updateStatus([...selected], status);
      if (res.status === false) setError(res.message);
      else setNotice(res.message);

      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'SELECT',
        label: (
          <Checkbox
            size="small"
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.ID)))}
            inputProps={{ 'aria-label': '全選' }}
          />
        ),
        render: (_, row) => (
          <Checkbox
            size="small"
            checked={selected.has(row.ID)}
            // 勾選框在可點擊的列裡：不擋住冒泡的話，打勾會順便打開詳情
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(row.ID)}
            inputProps={{ 'aria-label': `選取 ${row.CASE_NUM}` }}
          />
        )
      },
      { key: 'THUMBNAILS', label: '照片', render: (v) => <ImageCell images={v ?? []} /> },
      { key: 'CASE_NUM', label: '巡查單號', mono: true },
      { key: 'TYPE', label: '類型', render: (v) => CasePresenter.maintenanceTypeLabel(v) },
      {
        key: 'STATUS',
        label: '狀態',
        render: (v) => <StatusChip label={CasePresenter.maintenanceLabel(v)} color={MAINTENANCE_COLOR[v] ?? 'var(--c-neutral)'} />
      },
      { key: 'SURVEY_DATE', label: '調查日' },
      { key: 'SURVEY_USER', label: '調查人員' },
      { key: 'DTYPE', label: '破壞類型', render: (v) => CasePresenter.crackLabel(v) },
      { key: 'DEGREE', label: '程度', render: (v) => CasePresenter.degreeLabel(v) },
      { key: 'POTHOLE_NUMBER', label: '坑洞號', mono: true },
      { key: 'DISTRICT', label: '行政區' },
      { key: 'ADDRESS', label: '破壞地址' },
      { key: 'DTYPE_AREA', label: '面積 m²', type: 'number', digits: 2 },
      { key: 'MATERIAL_NAME', label: '材料' },
      {
        key: 'WORK_ORDER_NUM',
        label: '派工單',
        // 派工狀態一起帶出來：巡查單列表最常被問的就是「這張派了沒、派到哪了」
        render: (v, row) =>
          v ? (
            <StatusChip label={`${v} ${row.WORK_ORDER_STATUS_NAME ?? ''}`} color={WORK_ORDER_COLOR[row.WORK_ORDER_STATUS] ?? 'var(--c-neutral)'} />
          ) : (
            '未派工'
          )
      },
      { key: 'PRJ_ID', label: '標案', mono: true }
    ],
    [rows, selected, allSelected]
  );

  if (error && !rows.length) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          共 {total || rows.length} 張巡查單{selected.size > 0 && `，已選 ${selected.size} 張`}
        </Typography>

        <Chip size="small" variant="outlined" color={connected ? 'success' : 'default'} label={connected ? '即時更新中' : '連線中…'} />

        {can('MAINTENANCE.UPDATE') && (
          <Button size="small" startIcon={<VisibilityIcon />} disabled={!selected.size} onClick={() => batch(1)}>
            轉為觀察中
          </Button>
        )}
        {can('MAINTENANCE.APPROVE') && (
          <Button size="small" color="info" startIcon={<RestoreFromTrashIcon />} disabled={!selected.size} onClick={() => batch(RESTORE)}>
            復原
          </Button>
        )}
        {can('MAINTENANCE.DELETE') && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={!selected.size}
            onClick={() => window.confirm(`確定要刪除 ${selected.size} 張巡查單？已有派工單的會被跳過並說明原因。`) && batch(-1)}
          >
            刪除
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="warning" sx={{ whiteSpace: 'pre-line' }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

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

      <Box>
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
          emptyText="查無符合條件的巡查單"
        />
      </Box>

      <MaintenanceDialog
        open={!!active}
        row={active}
        onClose={() => setActive(null)}
        onSaved={load}
        onDispatch={(row) => {
          setActive(null);
          setDispatchRow(row);
        }}
      />

      <DispatchDialog
        open={!!dispatchRow}
        caseRow={dispatchRow}
        source="MAINTENANCE"
        onClose={() => setDispatchRow(null)}
        onSaved={() => {
          setDispatchRow(null);
          load();
        }}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={6000}
        onClose={() => setNotice('')}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
