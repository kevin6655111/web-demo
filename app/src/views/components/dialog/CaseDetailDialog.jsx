import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
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
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import BuildIcon from '@mui/icons-material/Build';
import ChatIcon from '@mui/icons-material/Chat';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SpecSheet from '../form/SpecSheet';
import ImageViewer from '../image/ImageViewer';
import DispatchDialog from './DispatchDialog';
import CaseHistoryDialog from '../CaseHistoryDialog';
import CaseChatPanel from './CaseChatPanel';
import { caseApi, projectApi, workOrderApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { opts } from '../../../config/queryFields';
import { BASEMAPS } from '../../../config/mapConfig';
import { CRACK_LABEL, DEGREE_COLOR, DEGREE_LABEL, MATERIAL_LABEL } from '../../../styles/theme';
import { useUser } from '../../../context/UserContext';

/** 可編輯的欄位；只有這些會進 PATCH，其餘是事實而不是意見 */
const EDITABLE = ['CRACK_TYPE', 'DEGREE', 'LENGTH', 'WIDTH', 'AREA', 'DEPTH', 'COUNTY', 'DISTRICT', 'CAVLGE', 'ROAD', 'ADDRESS', 'PROJECT_ID', 'REMARK'];
const NUMERIC = ['LENGTH', 'WIDTH', 'AREA', 'DEPTH', 'PROJECT_ID'];

/**
 * 案件詳情。
 *
 * 點清單的一列、或點地圖上的一個點，都開這一個 ——
 * 兩處看到的東西不一樣的話，使用者會不知道該相信哪一個。
 *
 * **檢視與編輯不分開**：欄位直接就地可改，改了才會亮起「儲存變更」。
 * 分成兩個對話框的話，承辦得先看一遍、關掉、再開編輯視窗找同一個欄位 ——
 * 而複查案件本來就是「看一眼、順手改一個值」的動作。
 *
 * 支援上下筆翻頁：審案件是一筆接一筆看的。
 */
export default function CaseDetailDialog({ open, caseId, caseList = [], onClose, onChanged }) {
  const { can } = useUser();
  const [origin, setOrigin] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [workOrder, setWorkOrder] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('info');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [currentId, setCurrentId] = useState(caseId);

  useEffect(() => setCurrentId(caseId), [caseId]);

  // 索引跟著「目前正在看的那筆」走，不是外部傳進來的初始值 ——
  // 用 caseId 的話翻頁後計數不會動
  const index = useMemo(() => caseList.findIndex((c) => c.ID === currentId), [caseList, currentId]);

  useEffect(() => {
    if (!open) return;

    projectApi
      .list()
      .then((res) => setProjects(res.data ?? []))
      .catch(() => {});
  }, [open]);

  const load = useCallback(async (id) => {
    if (!id) return;

    setLoading(true);
    try {
      const res = await caseApi.detail(id);
      const row = res.data ?? null;

      setOrigin(row);
      setForm(row ? Object.fromEntries(EDITABLE.map((k) => [k, row[k] ?? ''])) : {});
      setErrors({});

      // 派工單與重複案件各自查：其中一個失敗不該讓整個詳情空白
      workOrderApi
        .list({ CASE_PATROL_ID: id, SIZE: 1 })
        .then((wo) => setWorkOrder((wo.data?.ROWS ?? [])[0] ?? null))
        .catch(() => setWorkOrder(null));

      caseApi
        .duplicates(id)
        .then((d) => setDuplicates(d.data ?? []))
        .catch(() => setDuplicates([]));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !currentId) return;

    setTab('info');
    setNotice('');
    load(currentId);
  }, [open, currentId, load]);

  const go = (delta) => {
    const next = caseList[index + delta];
    if (next) setCurrentId(next.ID);
  };

  // 與原始資料有差異時才允許儲存 —— 沒改卻按得下去，會寫出一個沒有變更的版本
  const changed = useMemo(() => {
    if (!origin) return {};

    return Object.fromEntries(
      EDITABLE.filter((k) => {
        const a = origin[k] ?? '';
        const b = form[k] ?? '';
        return String(a) !== String(b);
      }).map((k) => [k, form[k]])
    );
  }, [origin, form]);

  const isDirty = Object.keys(changed).length > 0;

  const handleSave = async () => {
    const next = {};
    if (!form.CRACK_TYPE) next.CRACK_TYPE = '必填';
    if (!form.DEGREE) next.DEGREE = '必填';
    for (const key of ['LENGTH', 'WIDTH', 'AREA', 'DEPTH']) {
      if (form[key] !== '' && Number(form[key]) < 0) next[key] = '不可為負';
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setError('');

    try {
      const body = { ID: origin.ID };
      for (const [k, v] of Object.entries(changed)) {
        if (v === '' || v === null || v === undefined) continue;
        body[k] = NUMERIC.includes(k) ? Number(v) : v;
      }

      const res = await caseApi.update(body);
      setNotice(res.message);
      await load(origin.ID);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 標記待觀察(1 觀察中)：判定「這個先不派工，但要盯著」。
   * 成功後直接跳下一筆 —— 二篩是一筆接一筆看的工作。
   */
  const handleObserve = async () => {
    setSaving(true);
    try {
      await caseApi.updateStatus({ ID: origin.ID, NEED_REPAIR: 1 });
      onChanged?.();
      if (index >= 0 && index < caseList.length - 1) go(1);
      else await load(origin.ID);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const c = origin;
  const color = c ? CasePresenter.needRepairColor(c.NEED_REPAIR) : 'var(--c-neutral)';

  const images = useMemo(
    () =>
      [
        { url: c?.IMG_DETECT_URL, title: 'AI 判讀' },
        { url: c?.IMG_URL, title: '原始照片' }
      ].filter((i) => i.url),
    [c]
  );

  /** 表單分組；順序與現場的判讀順序一致：先看什麼破壞，再看多大，最後才是在哪 */
  const groups = useMemo(() => {
    if (!c) return [];

    return [
      {
        title: '基本資料',
        fields: [
          { label: '案件編號', name: 'CASE_NUM', span: 6 },
          { label: '原始編號', name: 'EXTERNAL_ID', span: 6 },
          { label: '檢測時間', name: 'DT_RECORD_TEXT', span: 6 },
          { label: '案件來源', name: 'SOURCE_TEXT', span: 6 },
          { label: '車牌號', name: 'CAR', span: 6 },
          { label: '車機序號', name: 'SERIAL_NO', span: 6 },
          {
            label: '標案名稱',
            name: 'PROJECT_ID',
            type: 'select',
            span: 12,
            options: projects.map((p) => ({ value: String(p.ID), label: `${p.PRJ_ID} ${p.PRJ_NAME}` }))
          }
        ]
      },
      {
        title: '破壞資訊',
        fields: [
          { label: '破壞類型', name: 'CRACK_TYPE', type: 'select', required: true, span: 6, options: opts(CRACK_LABEL) },
          { label: '嚴重程度', name: 'DEGREE', type: 'select', required: true, span: 6, options: opts(DEGREE_LABEL) },
          { label: '破壞序號', name: 'CRACK_ID', span: 6 },
          { label: '高程', name: 'ALTITUDE_TEXT', span: 6 }
        ]
      },
      {
        title: '尺寸',
        fields: [
          { label: '長度', name: 'LENGTH', type: 'number', unit: 'm', span: 6 },
          { label: '寬度', name: 'WIDTH', type: 'number', unit: 'm', span: 6 },
          { label: '面積', name: 'AREA', type: 'number', unit: 'm²', span: 6 },
          { label: '深度', name: 'DEPTH', type: 'number', unit: 'cm', span: 6 }
        ]
      },
      {
        title: '地址資訊',
        fields: [
          { label: '縣市', name: 'COUNTY', type: 'text', span: 6 },
          { label: '行政區', name: 'DISTRICT', type: 'text', span: 6 },
          { label: '里別', name: 'CAVLGE', type: 'text', span: 6 },
          { label: '路名', name: 'ROAD', type: 'text', span: 6 },
          { label: '定位地址', name: 'ADDRESS', type: 'text', span: 12 },
          { label: '原始地址', name: 'O_ADDRESS', span: 12 },
          { label: '定位座標', name: 'LNGLAT_TEXT', span: 12 },
          {
            label: '重複破壞',
            name: 'DUPLICATES',
            span: 12,
            // 同一個坑洞常被重複拍到；派工前看一眼，免得派兩班人去修同一個坑
            render: () =>
              duplicates.length ? (
                <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap sx={{ py: 0.3 }}>
                  {duplicates.map((d) => (
                    <Tooltip key={d.ID} title={`${CasePresenter.crackLabel(d.CRACK_TYPE)} · ${d.DISTANCE_M} 公尺外 · ${CasePresenter.time(d.DT_RECORD)}`}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${d.CASE_NUM}（${d.DISTANCE_M}m）`}
                        onClick={() => setCurrentId(d.ID)}
                        sx={{ height: 21, fontSize: 11, cursor: 'pointer' }}
                      />
                    </Tooltip>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.disabled">
                  無
                </Typography>
              )
          }
        ]
      },
      {
        title: '狀態與經手',
        fields: [
          { label: '二篩狀態', name: 'STATUS_TEXT', span: 4 },
          { label: '二篩人員', name: 'UPD_STATUS_USR', span: 4 },
          { label: '二篩時間', name: 'UPD_STATUS_AT_TEXT', span: 4 },
          { label: '複審人員', name: 'UPD_STATUS_ADM', span: 6 },
          { label: '複審時間', name: 'UPD_STATUS_ADM_AT_TEXT', span: 6 },
          { label: '人工編輯', name: 'EDITED_TEXT', span: 4 },
          { label: '編輯人員', name: 'UPD_EDITED_USR', span: 4 },
          { label: '編輯時間', name: 'UPD_EDITED_AT_TEXT', span: 4 },
          { label: '修繕狀態', name: 'NEED_REPAIR_TEXT', span: 4 },
          { label: '判定人員', name: 'UPD_NEED_REPAIR_USR', span: 4 },
          { label: '判定時間', name: 'UPD_NEED_REPAIR_AT_TEXT', span: 4 },
          { label: '備註', name: 'REMARK', type: 'text', span: 12 }
        ]
      }
    ];
  }, [c, projects, duplicates]);

  /** 唯讀欄位先算成文字：格線只負責排版，不該在裡面塞格式化邏輯 */
  const sheetValue = useMemo(() => {
    if (!c) return {};

    return {
      ...c,
      ...form,
      DT_RECORD_TEXT: CasePresenter.time(c.DT_RECORD),
      SOURCE_TEXT: CasePresenter.sourceLabel(c.SOURCE),
      ALTITUDE_TEXT: c.ALTITUDE != null ? `${Number(c.ALTITUDE).toFixed(1)} m` : null,
      LNGLAT_TEXT: c.LAT && c.LNG ? `${Number(c.LAT).toFixed(6)}, ${Number(c.LNG).toFixed(6)}` : null,
      STATUS_TEXT: CasePresenter.statusLabel(c.STATUS),
      EDITED_TEXT: c.EDITED === 1 ? '已編輯' : '未編輯',
      NEED_REPAIR_TEXT: CasePresenter.needRepairLabel(c.NEED_REPAIR),
      UPD_STATUS_AT_TEXT: CasePresenter.time(c.UPD_STATUS_USR_AT),
      UPD_STATUS_ADM_AT_TEXT: CasePresenter.time(c.UPD_STATUS_ADM_AT),
      UPD_EDITED_AT_TEXT: CasePresenter.time(c.UPD_EDITED_AT),
      UPD_NEED_REPAIR_AT_TEXT: CasePresenter.time(c.UPD_NEED_REPAIR_AT)
    };
  }, [c, form]);

  if (!open) return null;

  const canEdit = can('CASE.UPDATE');

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: { md: '90vh' } } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />

            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h6" noWrap sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {c?.CASE_NUM ?? c?.EXTERNAL_ID ?? '案件詳情'}
                </Typography>
                {c && (
                  <>
                    <Chip size="small" variant="outlined" label={CasePresenter.needRepairLabel(c.NEED_REPAIR)} sx={{ borderColor: color, color }} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={CasePresenter.degreeLabel(c.DEGREE)}
                      sx={{ borderColor: DEGREE_COLOR[c.DEGREE], color: DEGREE_COLOR[c.DEGREE] }}
                    />
                    {c.EDITED === 1 && <Chip size="small" color="warning" variant="outlined" label="人工編輯過" />}
                  </>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {c ? `${CasePresenter.crackLabel(c.CRACK_TYPE)} · ${c.ROAD ?? c.ADDRESS ?? '定位中…'}` : ''}
              </Typography>
            </Stack>

            {caseList.length > 1 && index >= 0 && (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <IconButton size="small" aria-label="上一筆案件" disabled={index <= 0} onClick={() => go(-1)}>
                  <KeyboardArrowLeftIcon fontSize="small" />
                </IconButton>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {index + 1} / {caseList.length}
                </Typography>
                <IconButton size="small" aria-label="下一筆案件" disabled={index >= caseList.length - 1} onClick={() => go(1)}>
                  <KeyboardArrowRightIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}

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
          <Tab value="info" label="案件內容" />
          <Tab value="workorder" label={workOrder ? `派工（${CasePresenter.workOrderLabel(workOrder.STATUS)}）` : '派工'} />
          <Tab value="chat" label="討論" icon={<ChatIcon sx={{ fontSize: 15 }} />} iconPosition="start" />
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

          {!c && !loading && <Typography color="text.secondary">載入中…</Typography>}

          {c && tab === 'info' && (
            // 表單與照片並排：判讀時要一邊看照片一邊改欄位，
            // 分成上下的話改一個值就要捲動一次
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '7fr 5fr' }, gap: 2, alignItems: 'start' }}>
              <SpecSheet groups={groups} value={sheetValue} errors={errors} onChange={setForm} readOnly={!canEdit} />

              <Stack spacing={1.5} sx={{ position: { md: 'sticky' }, top: 0 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
                    案件照片
                  </Typography>

                  {images.length ? (
                    <Stack spacing={1}>
                      {images.map((img) => (
                        <Box key={img.title}>
                          <Typography variant="caption" color="text.secondary">
                            {img.title}
                          </Typography>
                          <Box
                            sx={{
                              mt: 0.4,
                              px: 1,
                              py: 1.4,
                              borderRadius: 1,
                              border: (t) => `1px dashed ${t.palette.divider}`,
                              bgcolor: 'action.hover',
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: 11,
                              wordBreak: 'break-all',
                              color: 'text.secondary'
                            }}
                          >
                            {img.key}
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      此案件沒有照片
                    </Typography>
                  )}
                </Paper>

                {c.LNG && c.LAT && (
                  <Paper variant="outlined" sx={{ height: 240, overflow: 'hidden', position: 'relative' }}>
                    <MapContainer
                      center={[c.LAT, c.LNG]}
                      zoom={17}
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                      dragging={false}
                      scrollWheelZoom={false}
                      doubleClickZoom={false}
                      attributionControl={false}
                    >
                      <TileLayer url={BASEMAPS.EMAP.url} maxZoom={19} />
                      <CircleMarker center={[c.LAT, c.LNG]} radius={9} pathOptions={{ color, fillColor: color, fillOpacity: 0.8, weight: 3 }} />
                    </MapContainer>

                    <Tooltip title="在 Google 地圖開啟街景">
                      <IconButton
                        size="small"
                        component="a"
                        target="_blank"
                        rel="noopener"
                        aria-label="開啟街景"
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.LAT},${c.LNG}`}
                        sx={{ position: 'absolute', right: 8, top: 8, bgcolor: 'background.paper' }}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Paper>
                )}
              </Stack>
            </Box>
          )}

          {c && tab === 'workorder' && (
            <Stack spacing={2}>
              {workOrder ? (
                <>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" variant="outlined" color="primary" label={CasePresenter.workOrderLabel(workOrder.STATUS)} />
                    <Chip size="small" variant="outlined" label={CasePresenter.workOrderTypeLabel(workOrder.TYPE)} />
                    <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                      {workOrder.CASE_NUM}
                    </Typography>
                  </Stack>

                  <SpecSheet
                    readOnly
                    groups={[
                      {
                        title: '派工',
                        fields: [
                          { label: '施工人員', name: 'WORKER_USER', span: 6 },
                          { label: '派工人員', name: 'DISPATCHER', span: 6 },
                          { label: '派工日', name: 'DISPATCH_DATE', span: 6 },
                          { label: '限期完工', name: 'DUE_DATE', span: 6 },
                          { label: '開工日', name: 'WORK_START_DATE', span: 6 },
                          { label: '完工日', name: 'WORK_END_DATE', span: 6 }
                        ]
                      },
                      {
                        title: '施工',
                        fields: [
                          { label: '施工材料', name: 'MATERIAL_TEXT', span: 6 },
                          { label: '材料粒徑', name: 'MATERIAL_SIZE', unit: 'mm', span: 6 },
                          { label: '施工長度', name: 'WORK_LENGTH', unit: 'm', span: 6 },
                          { label: '施工寬度', name: 'WORK_WIDTH', unit: 'm', span: 6 },
                          { label: '施工地址', name: 'ADDRESS', span: 12 },
                          { label: '備註', name: 'REMARK', span: 12 }
                        ]
                      }
                    ]}
                    value={{ ...workOrder, MATERIAL_TEXT: MATERIAL_LABEL[workOrder.MATERIAL] ?? workOrder.MATERIAL }}
                  />

                  {workOrder.MISSING_IMAGE_COUNT > 0 && (
                    <Alert severity="warning">此派工單尚缺 {workOrder.MISSING_IMAGE_COUNT} 張必要照片，無法標記完工。</Alert>
                  )}
                </>
              ) : (
                <Alert severity="info">此案件尚未派工。</Alert>
              )}
            </Stack>
          )}

          {c && tab === 'chat' && <CaseChatPanel caseId={c.ID} />}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            歷程記錄
          </Button>

          <Box sx={{ flex: 1 }} />

          {canEdit && (
            <Button
              color="success"
              startIcon={<VisibilityIcon />}
              disabled={saving || !c || [1, 2].includes(c.NEED_REPAIR) || !!workOrder}
              onClick={handleObserve}
            >
              待觀察
            </Button>
          )}

          {can('WORK_ORDER.CREATE') && (
            <Button color="warning" startIcon={<BuildIcon />} disabled={!c || !!workOrder} onClick={() => setDispatching(true)}>
              建立派工單
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

      <DispatchDialog
        open={dispatching}
        caseRow={origin}
        onClose={() => setDispatching(false)}
        onSaved={() => {
          setDispatching(false);
          load(currentId);
          onChanged?.();
        }}
      />

      <ImageViewer open={viewerOpen} images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />

      <CaseHistoryDialog
        caseType="CASE_PATROL"
        caseId={historyOpen ? currentId : null}
        canRestore={canEdit}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          load(currentId);
          onChanged?.();
        }}
      />
    </>
  );
}
