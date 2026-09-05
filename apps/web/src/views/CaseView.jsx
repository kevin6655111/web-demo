import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack, Tab, Tabs } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import QueryForm from './components/query/QueryForm';
import DataTable, { StatusChip } from './components/query/DataTable';
import ImageCell from './components/query/ImageCell';
import CaseHistoryDialog from './components/CaseHistoryDialog';
import CaseDetailDialog from './components/dialog/CaseDetailDialog';
import { caseApi } from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import { caseQueryFields, toQueryParams } from '../config/queryFields';
import { useQueryOptions } from '../hooks/useQueryOptions';
import { DEGREE_COLOR, SOURCE_LABEL } from '../config/vocabulary';
import { useUser } from '../context/UserContext';

/**
 * 案件管理。
 *
 * 三個來源(AI 車巡 / APP 巡查 / 通道案件)是分頁而不是三個頁面：
 * 它們的欄位、狀態流轉、派工流程完全一樣，做成三份只會讓修改要改三次。
 */
export default function CaseView() {
  const { can } = useUser();
  const [source, setSource] = useState('ALL');
  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyId, setHistoryId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  // 選項跨畫面共用同一份快取：切到圖台再切回來不會重抓
  const queryOptions = useQueryOptions({ withCars: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { PAGE: page + 1, SIZE: size, ...toQueryParams(applied) };
      if (source !== 'ALL') params.SOURCE = source;

      const res = await caseApi.list(params);
      setRows(res.data?.ROWS ?? []);
      setTotal(res.data?.TOTAL ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, size, applied, source]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = useMemo(() => caseQueryFields(queryOptions), [queryOptions]);

  const columns = useMemo(
    () => [
      {
        key: 'IMG_URL',
        label: '照片',
        // 承辦掃清單時第一個看的是照片：「這是不是真的破壞」用看的比讀欄位快
        render: (_, row) => (
          <ImageCell
            images={[
              { url: row.IMG_DETECT_URL, title: 'AI 判讀' },
              { url: row.IMG_URL, title: '原始照片' }
            ]}
          />
        )
      },
      { key: 'CASE_NUM', label: '案件編號', mono: true },
      { key: 'SOURCE', label: '來源', render: (v) => CasePresenter.sourceLabel(v) },
      { key: 'CRACK_TYPE', label: '破壞類型', render: (v) => CasePresenter.crackLabel(v) },
      {
        key: 'DEGREE',
        label: '程度',
        render: (v) => <StatusChip label={CasePresenter.degreeLabel(v)} color={DEGREE_COLOR[v] ?? 'var(--c-neutral)'} />
      },
      {
        key: 'STATUS',
        label: '二篩',
        render: (v) => <StatusChip label={CasePresenter.statusLabel(v)} color={CasePresenter.statusColor(v)} />
      },
      {
        key: 'NEED_REPAIR',
        label: '案件狀態',
        render: (v) => <StatusChip label={CasePresenter.needRepairLabel(v)} color={CasePresenter.needRepairColor(v)} />
      },
      { key: 'DISTRICT', label: '行政區' },
      { key: 'ROAD', label: '路名' },
      { key: 'ADDRESS', label: '地址' },
      { key: 'LENGTH', label: '長 m', type: 'number', digits: 2 },
      { key: 'WIDTH', label: '寬 m', type: 'number', digits: 2 },
      { key: 'AREA', label: '面積 m²', type: 'number', digits: 2 },
      { key: 'DEPTH', label: '深 cm', type: 'number', digits: 1 },
      { key: 'CAR', label: '車牌', mono: true },
      { key: 'DT_RECORD', label: '發現時間', render: (v) => CasePresenter.time(v) },
      {
        key: 'ID',
        label: '歷程',
        align: 'right',
        render: (v) => (
          <Button
            size="small"
            startIcon={<HistoryIcon />}
            aria-label="檢視版本歷程"
            onClick={(e) => {
              e.stopPropagation();
              setHistoryId(v);
            }}
          >
            版本
          </Button>
        )
      }
    ],
    []
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Tabs
        value={source}
        onChange={(_, v) => {
          setSource(v);
          setPage(0);
        }}
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
      >
        <Tab value="ALL" label="全部" />
        {Object.entries(SOURCE_LABEL).map(([value, label]) => (
          <Tab key={value} value={value} label={label} />
        ))}
      </Tabs>

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
        onRowClick={(row) => setDetailId(row.ID)}
        emptyText="查無符合條件的案件"
      />

      <CaseDetailDialog open={!!detailId} caseId={detailId} caseList={rows} onClose={() => setDetailId(null)} onChanged={load} />

      <CaseHistoryDialog
        caseType="CASE_PATROL"
        caseId={historyId}
        canRestore={can('CASE.UPDATE')}
        onClose={() => setHistoryId(null)}
        onRestored={load}
      />
    </Stack>
  );
}
