import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import QueryForm from './components/query/QueryForm';
import DataTable, { StatusChip } from './components/query/DataTable';
import ImageCell from './components/query/ImageCell';
import { siftApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { SiftPresenter } from '../presenters/SiftPresenter';
import { siftQueryFields, toQueryParams } from '../config/queryFields';
import { useQueryOptions } from '../hooks/useQueryOptions';
import { useUser } from '../context/UserContext';

/** 判定結果：這三個是「判定」，未審與待審是流程狀態不是結果 */
const JUDGE = { PASS: 1, DELETE: 3, MISJUDGE: 4 };

/**
 * 二篩系統。
 *
 * 四個分頁對應四種角色行為，但共用同一組查詢條件與同一張表：
 * 判讀員判、管理者覆核、兩者都看統計、管理者結薪資。
 *
 * 判讀的操作重點是**批次**：一批看幾十張圖，逐張按等於按五十次。
 * 所以列表有勾選框、動作列在最上面，而照片放在第一欄 ——
 * 判讀員的視線是「看圖 → 勾 → 下一張」，不會去讀尺寸欄位。
 */
export default function SiftView() {
  const { can } = useUser();

  const tabs = useMemo(
    () =>
      [
        can('SIFT.JUDGE') && { value: 'general', label: '判讀作業' },
        can('SIFT.REVIEW') && { value: 'manage', label: '覆核作業' },
        can('SIFT.READ') && { value: 'stats', label: '判讀統計' },
        can('SIFT.MANAGE') && { value: 'salary', label: '薪資表' }
      ].filter(Boolean),
    [can]
  );

  const [tab, setTab] = useState(tabs[0]?.value);

  if (!tabs.length) return <Alert severity="warning">沒有二篩系統的檢視權限。</Alert>;

  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <Stack spacing={2}>
      <Tabs
        value={current}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
      >
        {tabs.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </Tabs>

      {current === 'general' && <SiftBoard mode="general" />}
      {current === 'manage' && <SiftBoard mode="manage" />}
      {current === 'stats' && <SiftStats />}
      {current === 'salary' && <SiftSalary />}
    </Stack>
  );
}

/** 判讀與覆核共用同一張表：差別只在送哪一支 API 與按鈕的字 */
function SiftBoard({ mode }) {
  const isReview = mode === 'manage';
  const queryOptions = useQueryOptions({ withCars: true });

  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await siftApi.list({
        TYPE: isReview ? 'MANAGE' : 'GENERAL',
        PAGE: page + 1,
        SIZE: size,
        ...toQueryParams(applied)
      });
      setRows(res.data?.ROWS ?? []);
      setTotal(res.data?.TOTAL ?? 0);
      // 換頁後舊的勾選沒有意義：使用者看不到那些列，卻會連它們一起送出
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isReview, page, size, applied]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && selected.size === rows.length;

  const submit = async (status) => {
    if (!selected.size) return;

    try {
      const ids = [...selected];
      const res = isReview ? await siftApi.review(ids, status) : await siftApi.judge(ids, status);
      setNotice(res.message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const fields = useMemo(() => siftQueryFields(queryOptions), [queryOptions]);

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
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(row.ID)}
            inputProps={{ 'aria-label': `選取 ${row.CASE_NUM}` }}
          />
        )
      },
      {
        key: 'IMG_DETECT_URL',
        label: '判讀圖',
        // AI 標註圖排在原圖前面：判讀員要先看「AI 認為這裡有什麼」
        render: (_, row) => (
          <ImageCell
            images={[
              { url: row.IMG_DETECT_URL, title: 'AI 判讀' },
              { url: row.IMG_URL, title: '原始照片' }
            ]}
            size={64}
          />
        )
      },
      { key: 'CASE_NUM', label: '案件編號', mono: true },
      { key: 'CRACK_TYPE_NAME', label: '破壞類型' },
      {
        key: 'DEGREE',
        label: '程度',
        render: (v) => <StatusChip label={CasePresenter.degreeLabel(v)} color={SiftPresenter.degreeColor(v)} />
      },
      {
        key: 'STATUS',
        label: '二篩',
        render: (v) => <StatusChip label={CasePresenter.statusLabel(v)} color={CasePresenter.statusColor(v)} />
      },
      { key: 'AREA', label: '面積 m²', type: 'number', digits: 2 },
      { key: 'DISTRICT', label: '行政區' },
      { key: 'ROAD', label: '路名' },
      { key: 'CAR', label: '車牌', mono: true },
      { key: 'DT_RECORD', label: '檢測時間', render: (v) => CasePresenter.time(v) },
      ...(isReview
        ? [
            { key: 'JUDGED_BY', label: '判讀員' },
            { key: 'JUDGED_AT', label: '判讀時間', render: (v) => (v ? CasePresenter.time(v) : '—') },
            { key: 'REVIEWED_BY', label: '覆核者' }
          ]
        : [])
    ],
    [rows, selected, allSelected, isReview]
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
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
        dense
      />

      <Paper sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
            共 {total} 筆{selected.size > 0 && `，已選 ${selected.size} 筆`}
          </Typography>

          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<CheckCircleIcon />}
            disabled={!selected.size}
            onClick={() => submit(JUDGE.PASS)}
          >
            {isReview ? '維持通過' : '通過'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            disabled={!selected.size}
            onClick={() => submit(JUDGE.MISJUDGE)}
          >
            {isReview ? '推翻為誤判' : '誤判'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DeleteOutlineIcon />}
            disabled={!selected.size}
            onClick={() => submit(JUDGE.DELETE)}
          >
            刪除
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
          {isReview
            ? '覆核會另外記一組時間與人，不會蓋掉判讀員的紀錄。已開立派工單的案件不可再更改。'
            : '已開立派工單、或已經管理者覆核的案件會被跳過並說明原因。'}
        </Typography>
      </Paper>

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
        emptyText={isReview ? '沒有待覆核的案件' : '沒有待判讀的案件'}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={6000}
        onClose={() => setNotice('')}
        message={notice}
        // 被跳過的原因是分行的，不換行的話會擠成一團看不懂
        ContentProps={{ sx: { whiteSpace: 'pre-line' } }}
      />
    </Stack>
  );
}

/** 判讀統計：量與品質要放在一起看 */
function SiftStats() {
  const [form, setForm] = useState({ GROUP_BY: 'USER' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const res = await siftApi.stats(toQueryParams(query));
      setRows(res.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ GROUP_BY: 'USER' });
  }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (loading) return <LinearProgress />;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={[
          {
            key: 'GROUP_BY',
            label: '分組',
            type: 'select',
            options: [
              { value: 'USER', label: '判讀員' },
              { value: 'DAY', label: '日期' },
              { value: 'DISTRICT', label: '行政區' },
              { value: 'CRACK_TYPE', label: '破壞類型' }
            ]
          },
          { key: 'START_DATE', label: '起', type: 'date' },
          { key: 'END_DATE', label: '迄', type: 'date' }
        ]}
        value={form}
        onChange={setForm}
        onSearch={() => load(form)}
        onReset={() => {
          setForm({ GROUP_BY: 'USER' });
          load({ GROUP_BY: 'USER' });
        }}
        dense
      />

      <DataTable
        columns={[
          { key: 'GROUP_KEY', label: '分組' },
          { key: 'TOTAL', label: '判定量', type: 'number', digits: 0 },
          { key: 'PASSED', label: '通過', type: 'number', digits: 0 },
          { key: 'MISJUDGED', label: '誤判', type: 'number', digits: 0 },
          { key: 'DELETED', label: '刪除', type: 'number', digits: 0 },
          { key: 'REVIEWED', label: '已覆核', type: 'number', digits: 0 },
          {
            key: 'PASS_RATE',
            label: '通過率',
            align: 'right',
            render: (v) => <StatusChip label={`${v}%`} color={SiftPresenter.passRateColor(v)} />
          }
        ]}
        rows={rows}
        emptyText="這個範圍沒有判定紀錄"
      />

      <Alert severity="info" sx={{ fontSize: 13 }}>
        通過率過高不一定是好事 —— 什麼都判通過的人這個數字會接近 100%。 要判斷品質，看薪資表的「準確率」（判完之後沒有被管理者推翻的比例）。
      </Alert>
    </Stack>
  );
}

/** 薪資表 */
function SiftSalary() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (m) => {
    setLoading(true);
    try {
      const res = await siftApi.salary({ MONTH: m });
      setData(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(thisMonth);
  }, [load, thisMonth]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={[{ key: 'MONTH', label: '結算月份', type: 'month', width: 160 }]}
        value={{ MONTH: month }}
        onChange={(v) => setMonth(v.MONTH)}
        onSearch={() => load(month)}
        onReset={() => {
          setMonth(thisMonth);
          load(thisMonth);
        }}
        dense
      />

      {loading && <LinearProgress />}

      {data && (
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">
                結算月份
              </Typography>
              <Typography variant="h6">{data.MONTH}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                總判定量
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {data.TOTAL_JUDGED}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                應付總額
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {data.TOTAL_NET}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                計價
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.4 }}>
                <Chip size="small" label={`每件 ${data.UNIT_PRICE}`} />
                <Chip size="small" color="error" variant="outlined" label={`誤判扣 ${data.ERROR_PRICE}`} />
              </Stack>
            </Box>
          </Stack>
        </Paper>
      )}

      <DataTable
        columns={[
          { key: 'EMPLOYEE_NO', label: '員工編號', mono: true },
          { key: 'USER_NAME', label: '判讀員' },
          { key: 'JUDGED', label: '判定量', type: 'number', digits: 0 },
          { key: 'OVERTURNED', label: '被推翻', type: 'number', digits: 0 },
          {
            key: 'ACCURACY',
            label: '準確率',
            render: (v) => <StatusChip label={`${v}%`} color={SiftPresenter.accuracyColor(v)} />
          },
          { key: 'GROSS', label: '應計', type: 'number', digits: 2 },
          { key: 'DEDUCTION', label: '扣款', type: 'number', digits: 2 },
          { key: 'NET', label: '應付', type: 'number', digits: 2 }
        ]}
        rows={data?.ROWS ?? []}
        emptyText="這個月沒有判定紀錄"
      />
    </Stack>
  );
}
