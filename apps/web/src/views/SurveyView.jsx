import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreIcon from '@mui/icons-material/Restore';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DataTable, { ProgressBar, StatusChip } from './components/query/DataTable';
import QueryForm from './components/query/QueryForm';
import ImageCell from './components/query/ImageCell';
import ConfirmDialog from './components/dialog/ConfirmDialog';
import { SurveyOrderDialog, SurveyCaseDialog } from './components/dialog/SurveyDialog';
import SurveyDetailDialog from './components/dialog/SurveyDetailDialog';
import SurveyTransferDialog from './components/dialog/SurveyTransferDialog';
import { surveyApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { SurveyPresenter } from '../presenters/SurveyPresenter';
import { SURVEY_METHOD_LABEL, SURVEY_ORDER_STATE_LABEL } from '../config/vocabulary';
import { useUser } from '../context/UserContext';

/**
 * 鋪面調查。
 *
 * 三層結構，而這個層級關係是整個模組的重點：
 *
 *   委託單   業主要求的一次調查
 *   └ 明細   業主指定的路段(哪條路、樁號、要幾個樣)
 *     └ 調查點  現場實際去量的一個位置
 *
 * 進度的分母是**明細的取樣數**而不是已排的點數 ——
 * 後者會讓一張還沒開始排點的委託單顯示 0/0 = 100%。
 */
export default function SurveyView() {
  const { can } = useUser();

  const tabs = useMemo(
    () =>
      [
        can('SURVEY.READ') && { value: 'order', label: '委託單' },
        can('SURVEY.READ') && { value: 'case', label: '調查點' },
        can('SURVEY.EXPERT') && { value: 'expert', label: '專家系統' }
      ].filter(Boolean),
    [can]
  );

  const [tab, setTab] = useState(tabs[0]?.value);

  if (!tabs.length) return <Alert severity="warning">沒有鋪面調查的檢視權限。</Alert>;

  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <Stack spacing={2}>
      <Tabs
        value={current}
        onChange={(_, v) => setTab(v)}
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
      >
        {tabs.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </Tabs>

      {current === 'order' && <OrderBoard />}
      {current === 'case' && <CaseBoard />}
      {current === 'expert' && <ExpertBoard />}
    </Stack>
  );
}

/** 委託單：展開一列就看得到它的明細與各項進度 */
function OrderBoard() {
  const { can } = useUser();
  const [orders, setOrders] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surveyApi.orders({});
      setOrders(res.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetails = async (order) => {
    if (expanded === order.ID) {
      setExpanded(null);
      return;
    }

    setExpanded(order.ID);
    try {
      const res = await surveyApi.details(order.ID);
      setDetails(res.data ?? []);
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;
  if (loading) return <LinearProgress />;

  return (
    <Stack spacing={2}>
      {can('SURVEY.UPDATE') && (
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => setDialog({ kind: 'order', row: null })}
        >
          新增委託單
        </Button>
      )}

      <DataTable
        columns={[
          {
            key: 'ID',
            label: '',
            render: (v, row) => (
              <IconButton
                size="small"
                aria-label="展開明細"
                onClick={(e) => {
                  e.stopPropagation();
                  openDetails(row);
                }}
              >
                {expanded === v ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            )
          },
          { key: 'ORDER_NO', label: '委託單號', mono: true },
          { key: 'TITLE', label: '標題', wrap: true },
          {
            key: 'STATE',
            label: '狀態',
            render: (v) => (
              <StatusChip label={SURVEY_ORDER_STATE_LABEL[v] ?? v} color={SurveyPresenter.orderStateColor(v)} />
            )
          },
          { key: 'REQUESTER', label: '委託單位' },
          { key: 'SURVEYOR', label: '調查人員' },
          { key: 'DETAIL_COUNT', label: '明細', type: 'number', digits: 0 },
          { key: 'SAMPLE_REQUIRED', label: '應取樣', type: 'number', digits: 0 },
          { key: 'CASE_DONE', label: '已完成', type: 'number', digits: 0 },
          { key: 'DUE_DATE', label: '期限' },
          {
            key: 'PROGRESS',
            label: '進度',
            align: 'right',
            render: (v) => <ProgressBar value={v} color={SurveyPresenter.progressColor(v)} />
          }
        ]}
        rows={orders}
        onRowClick={(row) => can('SURVEY.UPDATE') && setDialog({ kind: 'order', row })}
        emptyText="尚無委託單"
      />

      <Collapse in={!!expanded} unmountOnExit>
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              委託明細 —— 業主指定的路段
            </Typography>
            {can('SURVEY.UPDATE') && (
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setDialog({ kind: 'detail', row: null, orderId: expanded })}
              >
                新增明細
              </Button>
            )}
          </Stack>

          <DataTable
            columns={[
              { key: 'SEQ', label: '項次', type: 'number', digits: 0 },
              { key: 'ROAD', label: '路段' },
              { key: 'ROAD_START', label: '起' },
              { key: 'ROAD_END', label: '迄' },
              { key: 'STATION', label: '樁號', mono: true },
              { key: 'DIRECTION', label: '方向', render: (v) => SurveyPresenter.directionLabel(v) },
              { key: 'LANE_COUNT', label: '車道', type: 'number', digits: 0 },
              { key: 'ROAD_LENGTH_M', label: '長度 m', type: 'number', digits: 1 },
              { key: 'ROAD_WIDTH_M', label: '路寬 m', type: 'number', digits: 1 },
              { key: 'SAMPLE_COUNT', label: '應取樣', type: 'number', digits: 0 },
              { key: 'CASE_DONE', label: '已完成', type: 'number', digits: 0 },
              {
                key: 'PROGRESS',
                label: '進度',
                align: 'right',
                render: (v) => <ProgressBar value={v} color={SurveyPresenter.progressColor(v)} />
              }
            ]}
            rows={details}
            onRowClick={(row) => can('SURVEY.UPDATE') && setDialog({ kind: 'detail', row, orderId: expanded })}
            emptyText="這張委託單還沒有明細"
          />
        </Paper>
      </Collapse>

      <SurveyOrderDialog
        open={dialog?.kind === 'order'}
        row={dialog?.row}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          load();
        }}
      />

      <SurveyDetailDialog
        open={dialog?.kind === 'detail'}
        orderId={dialog?.orderId}
        row={dialog?.row}
        onClose={() => setDialog(null)}
        onSaved={async () => {
          setDialog(null);
          if (expanded) {
            const res = await surveyApi.details(expanded);
            setDetails(res.data ?? []);
          }
          load();
        }}
      />
    </Stack>
  );
}

/** 調查點：批次改狀態是這裡的主要操作 */
function CaseBoard() {
  const { can } = useUser();
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({});
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const [list, orderList] = await Promise.all([surveyApi.cases(query ?? {}), surveyApi.orders({})]);
      setRows(list.data ?? []);
      setOrders(orderList.data ?? []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({});
  }, [load]);

  const batch = async (state, reason) => {
    if (!selected.size) return;

    try {
      const res = await surveyApi.batchStatus([...selected], state, reason);
      setNotice(res.message);
      setConfirm(null);
      await load(form);
    } catch (err) {
      setError(err.message);
    }
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={[
          {
            key: 'ORDER_ID',
            label: '委託單',
            type: 'select',
            width: 220,
            options: orders.map((o) => ({ value: o.ID, label: `${o.ORDER_NO} ${o.TITLE}` }))
          },
          {
            key: 'STATE',
            label: '狀態',
            type: 'multi',
            options: [
              { value: 'PENDING', label: '待調查' },
              { value: 'DONE', label: '已完成' },
              { value: 'REJECTED', label: '不予採計' }
            ]
          },
          {
            key: 'METHOD',
            label: '調查方法',
            type: 'multi',
            options: Object.entries(SURVEY_METHOD_LABEL).map(([value, label]) => ({ value, label }))
          },
          { key: 'ROAD_NAME', label: '路名', width: 160 }
        ]}
        value={form}
        onChange={setForm}
        onSearch={() => load(form)}
        onReset={() => {
          setForm({});
          load({});
        }}
        dense
      />

      <Paper sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
            共 {rows.length} 個調查點{selected.size > 0 && `，已選 ${selected.size} 個`}
          </Typography>

          {can('SURVEY.UPDATE') && (
            <>
              <Button
                size="small"
                variant="contained"
                startIcon={<DoneAllIcon />}
                disabled={!selected.size}
                onClick={() => batch('DONE')}
              >
                標記完成
              </Button>
              <Button size="small" startIcon={<RestoreIcon />} disabled={!selected.size} onClick={() => batch('PENDING')}>
                退回待調查
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                disabled={!selected.size}
                onClick={() =>
                  setConfirm({
                    title: '刪除調查點',
                    message: `確定刪除 ${selected.size} 個調查點？\n這是軟刪除：資料留著，會出現在「已刪除案件表」，但不再進入報表。`,
                    danger: true,
                    onConfirm: () => batch('DELETED', '現場判定重複取樣')
                  })
                }
              >
                刪除
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setDialog({ kind: 'case', orderId: form.ORDER_ID ?? orders[0]?.ID })}
              >
                新增調查點
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      <DataTable
        columns={[
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
                onClick={(e) => e.stopPropagation()}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(row.ID) ? next.delete(row.ID) : next.add(row.ID);
                    return next;
                  })
                }
                inputProps={{ 'aria-label': `選取 ${row.ID}` }}
              />
            )
          },
          { key: 'ORDER_NO', label: '委託單號', mono: true },
          { key: 'ROAD_NAME', label: '路名' },
          { key: 'METHOD', label: '方法', render: (v) => SURVEY_METHOD_LABEL[v] ?? v },
          {
            key: 'STATE',
            label: '狀態',
            render: (v) => <StatusChip label={SurveyPresenter.caseStateLabel(v)} color={SurveyPresenter.caseStateColor(v)} />
          },
          { key: 'THICKNESS_CM', label: '厚度 cm', type: 'number', digits: 1 },
          {
            key: 'PCI',
            label: 'PCI',
            render: (v) => (v === null ? '—' : <StatusChip label={String(v)} color={SurveyPresenter.pciColor(v)} />)
          },
          { key: 'IRI', label: 'IRI', type: 'number', digits: 2 },
          { key: 'SEGMENT', label: '對應路段', mono: true },
          { key: 'SURVEYOR', label: '調查人員' },
          { key: 'SURVEYED_AT', label: '調查時間', render: (v) => (v ? CasePresenter.time(v) : '—') }
        ]}
        rows={rows}
        loading={loading}
        onRowClick={(row) => can('SURVEY.UPDATE') && setDialog({ kind: 'case', orderId: row.ORDER_ID, row })}
        emptyText="查無調查點"
      />

      <SurveyCaseDialog
        open={dialog?.kind === 'case'}
        orderId={dialog?.orderId}
        row={dialog?.row}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          load(form);
        }}
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

      <Snackbar
        open={!!notice}
        autoHideDuration={6000}
        onClose={() => setNotice('')}
        message={notice}
        ContentProps={{ sx: { whiteSpace: 'pre-line' } }}
      />
    </Stack>
  );
}

/** 專家系統：看得到全部欄位與已刪除的案件 */
function ExpertBoard() {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ INCLUDE_DELETED: 'true' });
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [transfer, setTransfer] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const [list, orderList] = await Promise.all([surveyApi.expertCases(query ?? {}), surveyApi.orders({})]);
      setRows(list.data ?? []);
      setOrders(orderList.data ?? []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ INCLUDE_DELETED: 'true' });
  }, [load]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Alert severity="info" sx={{ fontSize: 13 }}>
        專家系統看得到**所有現場欄位與已刪除的案件** —— 要判斷「這批資料能不能用」，
        被刪掉的那幾筆往往正是問題所在。轉讓是搬移而不是重建：現場照片與量測值會跟著走。
      </Alert>

      <QueryForm
        fields={[
          {
            key: 'ORDER_ID',
            label: '委託單',
            type: 'select',
            width: 220,
            options: orders.map((o) => ({ value: o.ID, label: `${o.ORDER_NO} ${o.TITLE}` }))
          },
          {
            key: 'SOURCE',
            label: '來源',
            type: 'multi',
            options: [
              { value: 'WEB', label: '網頁排點' },
              { value: 'APP', label: 'App 現場' },
              { value: 'DEVICE', label: '車機匯入' }
            ]
          },
          {
            key: 'INCLUDE_DELETED',
            label: '已刪除',
            type: 'select',
            options: [
              { value: 'true', label: '一併顯示' },
              { value: '', label: '排除' }
            ]
          },
          { key: 'ROAD_NAME', label: '路名', width: 160 }
        ]}
        value={form}
        onChange={setForm}
        onSearch={() => load(form)}
        onReset={() => {
          setForm({ INCLUDE_DELETED: 'true' });
          load({ INCLUDE_DELETED: 'true' });
        }}
        dense
      />

      <Paper sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ flex: 1 }}>
            共 {rows.length} 筆{selected.size > 0 && `，已選 ${selected.size} 筆`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<SwapHorizIcon />}
            disabled={!selected.size}
            onClick={() => setTransfer(true)}
          >
            轉讓案件
          </Button>
        </Stack>
      </Paper>

      <DataTable
        columns={[
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
                onClick={(e) => e.stopPropagation()}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(row.ID) ? next.delete(row.ID) : next.add(row.ID);
                    return next;
                  })
                }
                inputProps={{ 'aria-label': `選取 ${row.ID}` }}
              />
            )
          },
          { key: 'PHOTO_URL', label: '照片', render: (v) => <ImageCell images={[{ url: v, title: '現場照片' }]} /> },
          { key: 'CASE_NUM', label: '案件編號', mono: true },
          { key: 'ORDER_NO', label: '委託單', mono: true },
          { key: 'DETAIL_SEQ', label: '項次', type: 'number', digits: 0 },
          { key: 'SOURCE', label: '來源', render: (v) => SurveyPresenter.sourceLabel(v) },
          {
            key: 'DELETED_AT',
            label: '狀態',
            render: (v, row) =>
              v ? (
                <StatusChip label="已刪除" color="var(--c-error)" />
              ) : (
                <StatusChip label={SurveyPresenter.caseStateLabel(row.STATE)} color={SurveyPresenter.caseStateColor(row.STATE)} />
              )
          },
          { key: 'ROAD_NAME', label: '路名' },
          { key: 'DISTRICT', label: '行政區' },
          { key: 'LANE', label: '車道', type: 'number', digits: 0 },
          { key: 'STATION', label: '樁號', mono: true },
          { key: 'WEATHER', label: '天氣' },
          { key: 'DTYPE', label: '破壞類型', render: (v) => (v ? CasePresenter.crackLabel(v) : '—') },
          { key: 'DEGREE', label: '程度', render: (v) => (v ? CasePresenter.degreeLabel(v) : '—') },
          { key: 'DTYPE_AREA', label: '破壞面積 m²', type: 'number', digits: 2 },
          { key: 'DTYPE_QTY', label: '數量', type: 'number', digits: 0 },
          { key: 'THICKNESS_CM', label: '厚度 cm', type: 'number', digits: 1 },
          { key: 'PCI', label: 'PCI', type: 'number', digits: 1 },
          { key: 'DELETED_BY', label: '刪除者' }
        ]}
        rows={rows}
        loading={loading}
        emptyText="查無資料"
      />

      <SurveyTransferDialog
        open={transfer}
        ids={[...selected]}
        orders={orders}
        onClose={() => setTransfer(false)}
        onSaved={(message) => {
          setTransfer(false);
          setNotice(message);
          load(form);
        }}
      />

      <Snackbar open={!!notice} autoHideDuration={6000} onClose={() => setNotice('')} message={notice} />
    </Stack>
  );
}
