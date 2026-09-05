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
import VisibilityIcon from '@mui/icons-material/Visibility';
import EngineeringIcon from '@mui/icons-material/Engineering';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import SpecSheet from '../form/SpecSheet';
import ImageUploadField from '../form/ImageUploadField';
import CaseHistoryDialog from '../CaseHistoryDialog';
import { maintenanceApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { opts } from '../../../config/queryFields';
import { CRACK_LABEL, DEGREE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_TYPE_LABEL, MATERIAL_LABEL } from '../../../config/vocabulary';
import { useUser } from '../../../context/UserContext';

const EDITABLE = [
  'TYPE',
  'SURVEY_DATE',
  'PERIOD',
  'WEATHER',
  'DTYPE',
  'DEGREE',
  'DTYPE_LENGTH',
  'DTYPE_WIDTH',
  'COUNTY',
  'DISTRICT',
  'CAVLGE',
  'ADDRESS',
  'REMARK',
  'MATERIAL',
  'REFILL_LENGTH',
  'REFILL_WIDTH',
  'QUANTITY'
];

const NUMERIC = ['DTYPE_LENGTH', 'DTYPE_WIDTH', 'REFILL_LENGTH', 'REFILL_WIDTH', 'QUANTITY'];

const PERIODS = [
  { value: 'AM', label: '上午' },
  { value: 'PM', label: '下午' }
];

const WEATHERS = ['晴', '陰', '雨'].map((w) => ({ value: w, label: w }));

/**
 * 巡查單／巡修單。
 *
 * 與派工單的差別在「這張單記的是什麼」：巡查單記的是**發現了什麼**，
 * 所以它的狀態是待確認 → 觀察中 → 已派工，沒有施工流程。
 *
 * 巡修（RB）多一區回填內容 —— 整區顯示或整區不顯示，
 * 在一片欄位裡挑掉幾個會讓格線出現空洞。改回 RA 時後端會把那一列刪掉。
 */
export default function MaintenanceDialog({ open, row, onClose, onSaved, onDispatch }) {
  const { can } = useUser();
  const [origin, setOrigin] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [tab, setTab] = useState('info');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const m = origin;
  const status = m?.STATUS ?? 0;
  const type = form.TYPE ?? m?.TYPE;
  const deleted = status === -1;

  const canEdit = can('MAINTENANCE.UPDATE') && !deleted;
  const canDelete = can('MAINTENANCE.DELETE') && !deleted;
  const canRestore = can('MAINTENANCE.APPROVE') && deleted;

  // 已經有活著的派工單就不再開第二張：一張巡查單同時只能有一張有效派工單
  const canDispatch = can('WORK_ORDER.CREATE') && !deleted && (m?.WORK_ORDER_ID == null || m?.WORK_ORDER_STATUS === -1);

  const load = useCallback(async (id) => {
    if (!id) return;

    setLoading(true);
    try {
      const res = await maintenanceApi.detail(id);
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
  }, [open, row?.ID, load]);

  const changed = useMemo(() => {
    if (!origin) return {};

    return Object.fromEntries(EDITABLE.filter((k) => String(origin[k] ?? '') !== String(form[k] ?? '')).map((k) => [k, form[k]]));
  }, [origin, form]);

  const isDirty = Object.keys(changed).length > 0;

  const handleSave = async () => {
    const next = {};
    if (!form.ADDRESS) next.ADDRESS = '必填';
    if (!form.DISTRICT) next.DISTRICT = '必填';
    // 修掉了卻沒寫用什麼修，計價時無從對帳 —— 這個檢查後端也有一份
    if (type === 'RB' && !form.MATERIAL) next.MATERIAL = '巡修單必填';

    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setError('');

    try {
      const body = { ID: m.ID };
      for (const [k, v] of Object.entries(changed)) {
        if (v === '' || v === null || v === undefined) continue;
        body[k] = NUMERIC.includes(k) ? Number(v) : v;
      }

      const res = await maintenanceApi.update(body);
      setNotice(res.message);
      await load(m.ID);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 狀態變更。
   *
   * 端點是批次的，這裡送一筆 —— 訊息可能是「跳過，因為派工單還在」，
   * 所以不管成功失敗都要把後端的訊息顯示出來，而不是自己寫一句「已刪除」。
   */
  const changeStatus = async (statusValue) => {
    setSaving(true);
    setError('');

    try {
      const res = await maintenanceApi.updateStatus(m.ID, statusValue);

      // 被跳過時後端回 status:false，訊息裡寫著為什麼 —— 那正是使用者要看的
      if (res.status === false) setError(res.message);
      else setNotice(res.message);

      await load(m.ID);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const groups = useMemo(() => {
    if (!m) return [];

    return [
      {
        title: '基本資料',
        fields: [
          { label: '巡查單號', name: 'CASE_NUM', span: 6 },
          { label: '表單類型', name: 'TYPE', type: 'select', span: 6, options: opts(MAINTENANCE_TYPE_LABEL) },
          { label: '目前狀態', name: 'STATUS_TEXT', span: 6 },
          { label: '標案名稱', name: 'PROJECT_TEXT', span: 6 }
        ]
      },
      {
        title: '調查資料',
        fields: [
          { label: '調查日期', name: 'SURVEY_DATE', type: 'date', span: 4 },
          { label: '調查時段', name: 'PERIOD', type: 'select', span: 4, options: PERIODS },
          { label: '天氣', name: 'WEATHER', type: 'select', span: 4, options: WEATHERS },
          { label: '調查人員', name: 'SURVEY_USER', span: 6 },
          { label: '建單時間', name: 'CREATED_AT_TEXT', span: 6 }
        ]
      },
      {
        title: '破壞內容',
        fields: [
          { label: '破壞類型', name: 'DTYPE', type: 'select', span: 4, options: opts(CRACK_LABEL) },
          { label: '嚴重程度', name: 'DEGREE', type: 'select', span: 4, options: opts(DEGREE_LABEL) },
          // 坑洞編號由後端配發，改破壞類型時會跟著發或收 —— 前端不給改
          { label: '坑洞編號', name: 'POTHOLE_NUMBER', span: 4 },
          { label: '破壞長度', name: 'DTYPE_LENGTH', type: 'number', unit: 'm', span: 4 },
          { label: '破壞寬度', name: 'DTYPE_WIDTH', type: 'number', unit: 'm', span: 4 },
          { label: '破壞面積', name: 'DTYPE_AREA', span: 4 }
        ]
      },
      {
        title: '地點',
        fields: [
          { label: '縣市', name: 'COUNTY', type: 'text', span: 4 },
          { label: '行政區', name: 'DISTRICT', type: 'text', required: true, span: 4 },
          { label: '里別', name: 'CAVLGE', type: 'text', span: 4 },
          { label: '破壞地址', name: 'ADDRESS', type: 'text', required: true, span: 8 },
          { label: '座標', name: 'GEOM_TEXT', span: 4 }
        ]
      },
      // 回填內容只有 RB 用得到；RA 顯示這一區只會多四個永遠是空的欄位
      type === 'RB' && {
        title: '巡修回填',
        fields: [
          { label: '施工材料', name: 'MATERIAL', type: 'select', required: true, span: 6, options: opts(MATERIAL_LABEL) },
          { label: '用料數量', name: 'QUANTITY', type: 'number', unit: '包', span: 6 },
          { label: '回填長度', name: 'REFILL_LENGTH', type: 'number', unit: 'm', span: 6 },
          { label: '回填寬度', name: 'REFILL_WIDTH', type: 'number', unit: 'm', span: 6 }
        ]
      },
      {
        title: '派工與備註',
        fields: [
          { label: '派工單號', name: 'WORK_ORDER_NUM', span: 6 },
          { label: '派工狀態', name: 'WORK_ORDER_STATUS_NAME', span: 6 },
          { label: '備註', name: 'REMARK', type: 'text', span: 12 },
          { label: '異動人員', name: 'UPD_STATUS_USR', span: 6 },
          { label: '最後異動', name: 'UPD_STATUS_AT_TEXT', span: 6 }
        ]
      }
    ].filter(Boolean);
  }, [m, type]);

  const sheetValue = useMemo(() => {
    if (!m) return {};

    return {
      ...m,
      ...form,
      STATUS_TEXT: CasePresenter.maintenanceLabel(m.STATUS),
      PROJECT_TEXT: m.PRJ_ID ? `${m.PRJ_ID} ${m.PROJECT_NAME ?? ''}` : null,
      CREATED_AT_TEXT: CasePresenter.time(m.CREATED_AT),
      UPD_STATUS_AT_TEXT: CasePresenter.time(m.UPD_STATUS_AT),
      GEOM_TEXT: m.LAT != null ? `${Number(m.LAT).toFixed(5)}, ${Number(m.LNG).toFixed(5)}` : null
    };
  }, [m, form]);

  if (!open || !row) return null;

  const statusColor = MAINTENANCE_COLOR[status] ?? 'var(--c-neutral)';

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: { md: '90vh' } } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />

            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="h6" noWrap sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {m?.CASE_NUM ?? '巡查單'}
                </Typography>
                {m && (
                  <>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={CasePresenter.maintenanceLabel(status)}
                      sx={{ borderColor: statusColor, color: statusColor }}
                    />
                    <Chip size="small" variant="outlined" label={CasePresenter.maintenanceTypeLabel(m.TYPE)} />
                    {m.WORK_ORDER_NUM && <Chip size="small" variant="outlined" label={`派工 ${m.WORK_ORDER_NUM}`} />}
                    {m.MISSING_IMAGE_COUNT > 0 && (
                      <Chip size="small" color="warning" variant="outlined" label={`缺 ${m.MISSING_IMAGE_COUNT} 張必要照片`} />
                    )}
                  </>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {m?.ADDRESS}
              </Typography>
            </Stack>

            <IconButton size="small" aria-label="關閉" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}>
          <Tab value="info" label="單據內容" />
          <Tab value="image" label={m?.MISSING_IMAGE_COUNT > 0 ? `現場照片（缺 ${m.MISSING_IMAGE_COUNT}）` : '現場照片'} />
        </Tabs>

        <DialogContent dividers sx={{ p: 2 }}>
          {loading && <LinearProgress sx={{ mb: 1.5 }} />}

          {error && (
            <Alert severity="error" sx={{ mb: 1.5, whiteSpace: 'pre-line' }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert severity="success" sx={{ mb: 1.5, whiteSpace: 'pre-line' }} onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}

          {m && tab === 'info' && (
            <Stack spacing={1.5}>
              {deleted && <Alert severity="warning">此巡查單已刪除，內容不可修改。要繼續使用請先復原。</Alert>}

              <SpecSheet groups={groups} value={sheetValue} errors={errors} onChange={setForm} readOnly={!canEdit} />
            </Stack>
          )}

          {m && tab === 'image' && <ImageUploadField orderId={m.ID} canEdit={canEdit} api={maintenanceApi} onChanged={() => load(m.ID)} />}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            歷程記錄
          </Button>

          <Box sx={{ flex: 1 }} />

          {canRestore && (
            <Button color="info" startIcon={<RestoreFromTrashIcon />} disabled={saving} onClick={() => changeStatus(8)}>
              復原巡查單
            </Button>
          )}

          {canEdit && status === 0 && (
            <Button color="info" startIcon={<VisibilityIcon />} disabled={saving} onClick={() => changeStatus(1)}>
              轉為觀察中
            </Button>
          )}

          {canDispatch && (
            <Button color="primary" startIcon={<EngineeringIcon />} disabled={saving} onClick={() => onDispatch?.(m)}>
              開立派工單
            </Button>
          )}

          {canDelete && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={saving}
              onClick={() => window.confirm(`確定要刪除巡查單 ${m.CASE_NUM}？若它已有派工單，會被擋下並說明原因。`) && changeStatus(-1)}
            >
              刪除
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
        caseType="MAINTENANCE"
        caseId={historyOpen ? row.ID : null}
        canRestore={can('MAINTENANCE.UPDATE')}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          load(row.ID);
          onSaved?.();
        }}
      />
    </>
  );
}
