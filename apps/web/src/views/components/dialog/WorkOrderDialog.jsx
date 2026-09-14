import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SpecSheet from '../form/SpecSheet';
import ImageUploadField from '../form/ImageUploadField';
import CaseHistoryDialog from '../CaseHistoryDialog';
import { authApi, workOrderApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { opts } from '../../../config/queryFields';
import { MATERIAL_LABEL, WORK_ORDER_COLOR, WORK_UNIT_LABEL } from '../../../config/vocabulary';
import { useUser } from '../../../context/UserContext';

/** AI 車巡(PC) / APP 巡查(PD)：由巡查案件轉來的派工單 */
const isPatrol = (type) => ['PC', 'PD'].includes(type);

const EDITABLE = [
  'DUE_DATE',
  'WORK_START_DATE',
  'WORK_END_DATE',
  'WORKER_USER_ID',
  'WORK_UNIT',
  'COUNTY',
  'DISTRICT',
  'CAVLGE',
  'ADDRESS',
  'MATERIAL',
  'MATERIAL_SIZE',
  'WORK_LENGTH',
  'WORK_WIDTH',
  'WORK_DEPTH_MILLING',
  'WORK_DEPTH_PAVING',
  'SAMPLE_TAKEN',
  'SAMPLE_DATE',
  'TEST_ITEM',
  'REMARK'
];

const NUMERIC = ['MATERIAL_SIZE', 'WORK_LENGTH', 'WORK_WIDTH', 'WORK_DEPTH_MILLING', 'WORK_DEPTH_PAVING'];

/** 陣列欄位：空陣列是「清空指派」而不是「沒填」，所以不能被空值過濾掉 */
const ARRAY_FIELDS = ['WORKER_USER_ID', 'TEST_ITEM'];

const TEST_ITEMS = ['壓實度', '厚度', '瀝青含量', '篩分析', '含水量'];

/**
 * 派工單。
 *
 * **欄位依表單類型而不同**：PA 有刨鋪深度、PB 有取樣與十七張施工照、
 * PC/PD 由巡查案件轉來，只需要回填與施工前中後三張。
 * 所以排版的單位是「區塊」而不是「欄位」—— 整區顯示或整區不顯示，
 * 在一片欄位裡挑掉幾個會讓格線出現空洞。
 *
 * 內容、照片、狀態放在同一個對話框：驗收的人要同時看到「單上寫什麼」
 * 與「照片拍了什麼」才能決定收不收。
 */
export default function WorkOrderDialog({ open, row, onClose, onSaved }) {
  const { can, user } = useUser();
  const [origin, setOrigin] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [workers, setWorkers] = useState([]);
  const [tab, setTab] = useState('info');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const w = origin;
  const status = w?.STATUS ?? 0;
  const type = w?.TYPE;

  // 一張單可以派多人，所以是「我在不在名單上」而不是「我是不是那個人」
  const isWorker = (w?.WORKER_USER_ID ?? []).includes(user?.uid);
  const deleted = status === -1;

  const canEdit = can('WORK_ORDER.UPDATE') && status >= 0 && status < 3;
  const canReport = can('WORK_ORDER.UPDATE') && isWorker && status >= 0 && status < 2;
  const canAccept = can('WORK_ORDER.ACCEPT') && status === 2;

  // 撤回是「退一階」，任何往前走過的狀態都退得回來 —— 包含施工中退回待處理。
  // 完工與回報過的單只能撤回，不能直接刪：刪掉等於抹掉已經回報過的事實
  const canWithdraw = can('WORK_ORDER.APPROVE') && status >= 1;
  const canDelete = can('WORK_ORDER.DELETE') && status >= 0 && status < 2;
  const canRestore = can('WORK_ORDER.APPROVE') && deleted;

  const load = useCallback(async (id) => {
    if (!id) return;

    setLoading(true);
    try {
      const res = await workOrderApi.detail(id);
      const detail = res.data ?? null;

      setOrigin(detail);
      setForm(detail ? Object.fromEntries(EDITABLE.map((k) => [k, detail[k] ?? ''])) : {});
      setErrors({});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !row?.ID) return;

    setTab('info');
    setError('');
    setNotice('');
    load(row.ID);

    authApi
      .orgUsers()
      .then((res) => setWorkers((res.data ?? []).filter((u) => u.ACTIVE)))
      .catch(() => {});
  }, [open, row?.ID, load]);

  // 與原始資料有差異時才允許儲存
  const changed = useMemo(() => {
    if (!origin) return {};

    return Object.fromEntries(
      EDITABLE.filter((k) => {
        const a = origin[k] ?? '';
        const b = form[k] ?? '';
        return Array.isArray(a) || Array.isArray(b)
          ? JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])
          : String(a) !== String(b);
      }).map((k) => [k, form[k]])
    );
  }, [origin, form]);

  const isDirty = Object.keys(changed).length > 0;

  const handleSave = async () => {
    const next = {};
    if (!form.ADDRESS) next.ADDRESS = '必填';
    if (!form.DISTRICT) next.DISTRICT = '必填';
    // PB 的取樣資訊是業主驗收要查的，有取樣就一定要有日期與項目
    if (type === 'PB' && form.SAMPLE_TAKEN === true) {
      if (!form.SAMPLE_DATE) next.SAMPLE_DATE = '有取樣時必填';
      if (!form.TEST_ITEM?.length) next.TEST_ITEM = '有取樣時必填';
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setError('');

    try {
      const body = { ID: w.ID };
      for (const [k, v] of Object.entries(changed)) {
        if (ARRAY_FIELDS.includes(k)) {
          body[k] = (Array.isArray(v) ? v : v ? [v] : []).map(Number).filter(Boolean);
          continue;
        }
        if (v === '' || v === null || v === undefined) continue;
        body[k] = NUMERIC.includes(k) ? Number(v) : v;
      }

      const res = await workOrderApi.update(body);
      setNotice(res.message);
      await load(w.ID);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 送出狀態或動作碼。
   *
   * 8 復原、9 撤回、-1 刪除都走同一支端點 —— 它們的請求主體一模一樣，
   * 差別只在後端要先看這張單當前在哪裡。前端不自己算「退回哪一階」，
   * 那個規則會跟著業主的驗收流程改，兩邊各算一次遲早不一致。
   */
  const changeStatus = async (statusValue, rejectReason) => {
    setSaving(true);
    setError('');

    try {
      const res = await workOrderApi.updateStatus({
        ID: w.ID,
        STATUS: statusValue,
        REJECT_REASON: rejectReason || undefined
      });
      setNotice(res.message);
      onSaved?.();

      // 完工、退回、刪除會離開這張單；其餘只是往前或往後一步，留在原地看照片
      if ([3, 0, -1].includes(statusValue)) onClose?.();
      else await load(w.ID);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 表單分區。
   *
   * 條件依表單類型 —— 與後端 `WORK_ORDER_TYPE_DEF` / `IMAGE_GROUPS` 同一套規則，
   * 前端不自己判斷「PB 要不要取樣」，那樣兩邊遲早會不一致。
   */
  const groups = useMemo(() => {
    if (!w) return [];

    const patrol = isPatrol(type);

    const dispatchAddr = [
      {
        label: '施工人員',
        name: 'WORKER_USER_ID',
        type: 'multi',
        span: 6,
        // 不設 required：先開單、隔天早上點名才分工是現場的常態
        options: workers.map((u) => ({ value: u.ID, label: `${u.USER_NAME}（${u.ROLE}）` }))
      },
      { label: '施工單位', name: 'WORK_UNIT', type: 'select', span: 6, options: opts(WORK_UNIT_LABEL) },
      { label: '派工人員', name: 'DISPATCHER', span: 6 },
      { label: '來源巡查單', name: 'MAINTENANCE_NUM', span: 6 },
      { label: '縣市', name: 'COUNTY', type: 'text', span: 4 },
      { label: '行政區', name: 'DISTRICT', type: 'text', required: true, span: 4 },
      { label: '里別', name: 'CAVLGE', type: 'text', span: 4 },
      { label: '施工地址', name: 'ADDRESS', type: 'text', required: true, span: 12 },
      { label: '施工起迄', name: 'START_END_TEXT', span: 12 }
    ];

    return [
      {
        title: '基本資料',
        fields: [
          { label: '派工單號', name: 'CASE_NUM', span: 6 },
          { label: '表單類型', name: 'TYPE_TEXT', span: 6 },
          { label: '目前狀態', name: 'STATUS_TEXT', span: 6 },
          { label: '建單時間', name: 'CREATED_AT_TEXT', span: 6 }
        ]
      },
      patrol
        ? {
            title: '檢測資料',
            fields: [
              { label: '案件編號', name: 'CASE_PATROL_NUM', span: 6 },
              { label: '標案名稱', name: 'PROJECT_TEXT', span: 6 },
              { label: '破壞類型', name: 'CRACK_TYPE_TEXT', span: 6 },
              { label: '車牌號', name: 'CAR', span: 6 }
            ]
          }
        : {
            title: '標案資料',
            fields: [
              { label: '標案名稱', name: 'PROJECT_TEXT', span: 12 },
              { label: '縣市', name: 'COUNTY', type: 'text', span: 6 },
              { label: '行政區', name: 'DISTRICT', type: 'text', span: 6 }
            ]
          },
      {
        title: '派工內容',
        fields: [
          { label: '派工日期', name: 'DISPATCH_DATE', span: 6 },
          { label: '施工期限', name: 'DUE_DATE', type: 'date', span: 6 },
          { label: '施工日期', name: 'WORK_START_DATE', type: 'date', span: 6 },
          { label: '完工日期', name: 'WORK_END_DATE', type: 'date', span: 6 },
          ...dispatchAddr
        ]
      },
      patrol
        ? {
            title: '施工回填',
            fields: [
              { label: '施工材料', name: 'MATERIAL', type: 'select', span: 6, options: opts(MATERIAL_LABEL) },
              { label: '材料數量', name: 'MATERIAL_SIZE', type: 'number', unit: '包', span: 6 },
              { label: '回填長度', name: 'WORK_LENGTH', type: 'number', unit: 'm', span: 6 },
              { label: '回填寬度', name: 'WORK_WIDTH', type: 'number', unit: 'm', span: 6 }
            ]
          }
        : {
            title: '施工內容',
            fields: [
              { label: '施工材料', name: 'MATERIAL', type: 'select', span: 6, options: opts(MATERIAL_LABEL) },
              { label: '材料粒徑', name: 'MATERIAL_SIZE', type: 'number', unit: 'mm', span: 6 },
              { label: '施工長度', name: 'WORK_LENGTH', type: 'number', unit: 'm', span: 6 },
              { label: '施工寬度', name: 'WORK_WIDTH', type: 'number', unit: 'm', span: 6 },
              { label: '深度(刨)', name: 'WORK_DEPTH_MILLING', type: 'number', unit: 'cm', span: 6 },
              { label: '深度(鋪)', name: 'WORK_DEPTH_PAVING', type: 'number', unit: 'cm', span: 6 }
            ]
          },
      // 取樣只有 PB 用得到；其他三種類型顯示這一區只會多三個永遠是空的欄位
      type === 'PB' && {
        title: '取樣內容',
        fields: [
          {
            label: '是否取樣',
            name: 'SAMPLE_TAKEN',
            type: 'select',
            span: 4,
            options: [
              { value: true, label: '有取樣' },
              { value: false, label: '未取樣' }
            ]
          },
          { label: '取樣日期', name: 'SAMPLE_DATE', type: 'date', span: 4, disabled: form.SAMPLE_TAKEN !== true },
          {
            label: '試驗項目',
            name: 'TEST_ITEM',
            type: 'multi',
            span: 4,
            disabled: form.SAMPLE_TAKEN !== true,
            options: TEST_ITEMS.map((t) => ({ value: t, label: t }))
          },
          { label: '試驗結果', name: 'TEST_RESULT', span: 12 }
        ]
      },
      {
        title: '其它內容',
        fields: [
          { label: '備註', name: 'REMARK', type: 'text', span: 12 },
          { label: '退回原因', name: 'REJECT_REASON', span: 12 },
          { label: '異動人員', name: 'UPD_STATUS_USR', span: 6 },
          { label: '最後異動', name: 'UPD_STATUS_AT_TEXT', span: 6 }
        ]
      }
    ].filter(Boolean);
  }, [w, type, workers, form.SAMPLE_TAKEN]);

  const sheetValue = useMemo(() => {
    if (!w) return {};

    return {
      ...w,
      ...form,
      TYPE_TEXT: CasePresenter.workOrderTypeLabel(w.TYPE),
      STATUS_TEXT: CasePresenter.workOrderLabel(w.STATUS),
      CREATED_AT_TEXT: CasePresenter.time(w.CREATED_AT),
      UPD_STATUS_AT_TEXT: CasePresenter.time(w.UPD_STATUS_AT),
      PROJECT_TEXT: w.PRJ_ID ? `${w.PRJ_ID} ${w.PROJECT_NAME ?? ''}` : null,
      CRACK_TYPE_TEXT: w.CASE_CRACK_TYPE ? CasePresenter.crackLabel(w.CASE_CRACK_TYPE) : null,
      START_END_TEXT:
        w.START_LAT != null
          ? `${Number(w.START_LAT).toFixed(5)}, ${Number(w.START_LNG).toFixed(5)}${
              w.END_LAT != null ? ` → ${Number(w.END_LAT).toFixed(5)}, ${Number(w.END_LNG).toFixed(5)}` : ''
            }`
          : null
    };
  }, [w, form]);

  if (!open || !row) return null;

  const overdue = w?.DUE_DATE && status < 3 && new Date(w.DUE_DATE) < new Date();
  const statusColor = WORK_ORDER_COLOR[status] ?? 'var(--c-neutral)';

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: { md: '90vh' } } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />

            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="h6" noWrap sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {w?.CASE_NUM ?? '派工單'}
                </Typography>
                {w && (
                  <>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={CasePresenter.workOrderLabel(status)}
                      sx={{ borderColor: statusColor, color: statusColor }}
                    />
                    <Chip size="small" variant="outlined" label={CasePresenter.workOrderTypeLabel(w.TYPE)} />
                    {overdue && <Chip size="small" color="error" label="已逾期" />}
                    {w.MISSING_IMAGE_COUNT > 0 && (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`缺 ${w.MISSING_IMAGE_COUNT} 張必要照片`}
                      />
                    )}
                  </>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {w?.ADDRESS}
              </Typography>
            </Stack>

            <IconButton size="small" aria-label="關閉" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ px: 2, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
        >
          <Tab value="info" label="單據內容" />
          <Tab
            value="image"
            label={w?.MISSING_IMAGE_COUNT > 0 ? `施工照片（缺 ${w.MISSING_IMAGE_COUNT}）` : '施工照片'}
          />
        </Tabs>

        <DialogContent dividers sx={{ p: 2 }}>
          {loading && <LinearProgress sx={{ mb: 1.5 }} />}

          {error && (
            <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}

          {w && tab === 'info' && (
            <Stack spacing={1.5}>
              {status >= 3 && (
                <Alert severity="info">
                  此單已完工，內容不可修改。要改就作廢重開 —— 已驗收的單被改過，驗收紀錄就失去意義。
                </Alert>
              )}

              <SpecSheet groups={groups} value={sheetValue} errors={errors} onChange={setForm} readOnly={!canEdit} />
            </Stack>
          )}

          {w && tab === 'image' && (
            <ImageUploadField orderId={w.ID} orderType={type} canEdit={canEdit} onChanged={() => load(w.ID)} />
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            歷程記錄
          </Button>

          <Box sx={{ flex: 1 }} />

          {canReport && status === 0 && (
            <Button color="info" startIcon={<PlayArrowIcon />} disabled={saving} onClick={() => changeStatus(1)}>
              開始施工
            </Button>
          )}

          {canReport && status === 1 && (
            <Button
              color="info"
              startIcon={<AssignmentTurnedInIcon />}
              disabled={saving}
              onClick={() => changeStatus(2)}
            >
              回報案件
            </Button>
          )}

          {canRestore && (
            <Button color="info" startIcon={<RestoreFromTrashIcon />} disabled={saving} onClick={() => changeStatus(8)}>
              復原派工單
            </Button>
          )}

          {canWithdraw && (
            <Button color="secondary" startIcon={<UndoIcon />} disabled={saving} onClick={() => changeStatus(9)}>
              撤回一階
            </Button>
          )}

          {canDelete && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={saving}
              onClick={() =>
                window.confirm(`確定要刪除派工單 ${w.CASE_NUM}？來源案件會退回「觀察中」，可再次派工。`) &&
                changeStatus(-1)
              }
            >
              刪除派工單
            </Button>
          )}

          {canAccept && (
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              disabled={saving}
              onClick={() => changeStatus(3)}
            >
              已完工
            </Button>
          )}

          {canEdit && (
            <Button variant="contained" startIcon={<SaveIcon />} disabled={!isDirty || saving} onClick={handleSave}>
              儲存變更
            </Button>
          )}

          <Button onClick={onClose}>關閉</Button>
        </DialogActions>
      </Dialog>

      <CaseHistoryDialog
        caseType="WORK_ORDER"
        caseId={historyOpen ? row.ID : null}
        canRestore={can('WORK_ORDER.UPDATE')}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          load(row.ID);
          onSaved?.();
        }}
      />
    </>
  );
}
