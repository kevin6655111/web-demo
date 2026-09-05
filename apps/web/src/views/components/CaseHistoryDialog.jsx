import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import CloseIcon from '@mui/icons-material/Close';
import { historyApi } from '../../models/api/patrolApi';
import { CasePresenter } from '../../presenters/CasePresenter';

/**
 * 欄位表要列哪些欄位。
 *
 * 按類型分開列而不是一份通吃：派工單沒有「破壞程度」，案件沒有「刨除深度」，
 * 合成一份的話兩邊都會看到一堆永遠是空的列。
 * 標籤本身取自 CasePresenter，那裡已經有一份完整的對照。
 */
const SNAPSHOT_FIELDS = {
  CASE_PATROL: [
    'status',
    'needRepair',
    'edited',
    'crackType',
    'degree',
    'length',
    'width',
    'area',
    'depth',
    'county',
    'district',
    'cavlge',
    'road',
    'address',
    'projectId',
    'remark'
  ],
  WORK_ORDER: [
    'status',
    'type',
    'dispatchDate',
    'dueDate',
    'workStartDate',
    'workEndDate',
    'workerUserIds',
    'workUnit',
    'district',
    'address',
    'material',
    'materialSize',
    'workLength',
    'workWidth',
    'workDepthMilling',
    'workDepthPaving',
    'sampleTaken',
    'sampleDate',
    'testItem',
    'images',
    'remark'
  ],
  MAINTENANCE: [
    'status',
    'type',
    'surveyDate',
    'period',
    'weather',
    'dtype',
    'degree',
    'potholeNumber',
    'dtypeLength',
    'dtypeWidth',
    'dtypeArea',
    'district',
    'address',
    'material',
    'refillLength',
    'refillWidth',
    'quantity',
    'images',
    'remark'
  ],
  PROJECT: ['state', 'prjName', 'prjMain', 'prjSub', 'proprietor', 'proprietorLevel', 'startDate', 'endDate', 'budget', 'roadKm'],
  SURVEY: []
};

const TITLE = {
  CASE_PATROL: '案件歷程',
  MAINTENANCE: '巡查單歷程',
  WORK_ORDER: '派工單歷程',
  PROJECT: '標案歷程',
  SURVEY: '檢測案件歷程'
};

/**
 * 案件版本歷程。
 *
 * 兩種看法對應兩種問題：
 *   時間軸  「這個案件經歷了什麼」—— 承辦交接、客訴回覆時看這個
 *   欄位表  「這個欄位被誰改成什麼」—— 計價爭議時看這個
 *
 * 兩者的資料同一份，差別只在怎麼排。做成切換而不是兩個畫面，
 * 是因為使用者往往是先看時間軸、發現異常再切到欄位表追細節。
 */
export default function CaseHistoryDialog({ caseType = 'CASE_PATROL', caseId, canRestore, onClose, onRestored }) {
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('timeline');
  const [expanded, setExpanded] = useState(null);
  const [compare, setCompare] = useState([]);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!caseId) return;

    setLoading(true);
    setError('');
    try {
      const res = await historyApi.list(caseType, caseId);
      setRows(res.data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [caseType, caseId]);

  useEffect(() => {
    setNotice('');
    setCompare([]);
    setDiff(null);
    load();
  }, [load]);

  const handleRestore = async (version) => {
    try {
      const res = await historyApi.restore(caseType, caseId, version);
      setNotice(res.message);
      await load();
      onRestored?.();
    } catch (err) {
      setError(err.message);
    }
  };

  /** 勾選兩個版本後自動比較；選第三個時取代最舊的那個 */
  const toggleCompare = async (version) => {
    const next = compare.includes(version) ? compare.filter((v) => v !== version) : [...compare, version].slice(-2);
    setCompare(next);
    setDiff(null);

    if (next.length === 2) {
      const [from, to] = [...next].sort((a, b) => a - b);
      try {
        const res = await historyApi.diff(caseType, caseId, from, to);
        setDiff({ from, to, changes: res.data.CHANGES });
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const renderTimeline = () => (
    <Stack spacing={0}>
      {rows.map((h, i) => {
        const meta = CasePresenter.actionMeta(h.ACTION);
        const isLatest = i === rows.length - 1;
        const changes = Object.entries(h.CHANGES ?? {});
        const open = expanded === h.VERSION;

        return (
          <Stack key={h.VERSION} direction="row" spacing={2}>
            <Stack alignItems="center" sx={{ pt: 0.6 }}>
              <Box sx={{ width: 11, height: 11, borderRadius: '50%', bgcolor: meta.color, flexShrink: 0 }} />
              {!isLatest && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', my: 0.5 }} />}
            </Stack>

            <Box sx={{ pb: 2.2, flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`v${h.VERSION}`}
                  onClick={() => toggleCompare(h.VERSION)}
                  color={compare.includes(h.VERSION) ? 'primary' : 'default'}
                  sx={{ fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer' }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, color: meta.color }}>
                  {meta.label}
                </Typography>
                {/* 來源是人、排程、背景工作還是車機 —— 追查問題時這個差別很大 */}
                <Chip
                  size="small"
                  variant="outlined"
                  label={CasePresenter.sourceMeta(h.SOURCE).label}
                  sx={{ height: 19, fontSize: 10, borderColor: CasePresenter.sourceMeta(h.SOURCE).color, color: CasePresenter.sourceMeta(h.SOURCE).color }}
                />
                <Typography variant="caption" color="text.secondary">
                  {h.MODIFIED_BY ?? '系統'} · {CasePresenter.time(h.MODIFIED_AT)}
                </Typography>

                {(h.FROM_STATE || h.TO_STATE) && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>
                    {h.FROM_STATE ?? '—'} → {h.TO_STATE ?? '—'}
                  </Typography>
                )}

                <Box sx={{ flex: 1 }} />

                {changes.length > 0 && (
                  <Tooltip title={open ? '收合欄位' : `展開 ${changes.length} 個變更欄位`}>
                    <IconButton size="small" onClick={() => setExpanded(open ? null : h.VERSION)}>
                      <ExpandMoreIcon fontSize="small" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                    </IconButton>
                  </Tooltip>
                )}

                {canRestore && !isLatest && (
                  <Button size="small" startIcon={<RestoreIcon />} onClick={() => handleRestore(h.VERSION)}>
                    還原
                  </Button>
                )}
              </Stack>

              {/* 收合時只列欄位名，展開才給完整的前後值 —— 多數時候只需要知道「動到哪些欄位」 */}
              {changes.length > 0 && !open && (
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.6 }} flexWrap="wrap" useFlexGap>
                  {changes.map(([field]) => (
                    <Chip key={field} size="small" label={CasePresenter.fieldLabel(field)} sx={{ height: 19, fontSize: 10 }} />
                  ))}
                </Stack>
              )}

              <Collapse in={open}>
                <Table size="small" sx={{ mt: 1, '& td, & th': { borderColor: 'divider', py: 0.6 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 110 }}>欄位</TableCell>
                      <TableCell>變更前</TableCell>
                      <TableCell>變更後</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {changes.map(([field, ch]) => (
                      <TableRow key={field}>
                        <TableCell sx={{ color: 'text.secondary' }}>{CasePresenter.fieldLabel(field)}</TableCell>
                        <TableCell sx={{ color: 'var(--c-error)', fontSize: 12 }}>{CasePresenter.fieldValue(field, ch.from)}</TableCell>
                        <TableCell sx={{ color: 'var(--c-success)', fontSize: 12 }}>{CasePresenter.fieldValue(field, ch.to)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* 該版本的完整樣貌：變更表只說「動了什麼」，還原前想看的是「還原成什麼」 */}
                {h.SNAPSHOT && (
                  <Box sx={{ mt: 1.2 }}>
                    <Typography variant="caption" color="text.secondary">
                      此版本完整內容
                    </Typography>
                    <Box
                      sx={{
                        mt: 0.5,
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                        gap: 0.4
                      }}
                    >
                      {Object.entries(h.SNAPSHOT).map(([field, val]) => (
                        <Stack key={field} direction="row" spacing={1}>
                          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 84 }}>
                            {CasePresenter.fieldLabel(field)}
                          </Typography>
                          <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                            {CasePresenter.fieldValue(field, val)}
                          </Typography>
                        </Stack>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* 來源 IP：稽核時要能回答「是不是從辦公室改的」 */}
                {h.CLIENT_IP && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.8, display: 'block', fontFamily: '"JetBrains Mono", monospace' }}>
                    來源 IP：{h.CLIENT_IP}
                  </Typography>
                )}
              </Collapse>

              {h.NOTE && (
                <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                  「{h.NOTE}」
                </Typography>
              )}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );

  /** 欄位表：一欄一個版本，橫著看就是某個欄位的變化史 */
  const renderMatrix = () => (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: 'divider', whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>欄位</TableCell>
            {rows.map((h) => (
              <TableCell key={h.VERSION} align="center">
                <Stack alignItems="center">
                  <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    v{h.VERSION}
                  </Typography>
                  <Typography variant="caption" sx={{ color: CasePresenter.actionMeta(h.ACTION).color, fontSize: 10 }}>
                    {CasePresenter.actionMeta(h.ACTION).label}
                  </Typography>
                </Stack>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {(SNAPSHOT_FIELDS[caseType] ?? []).map((field) => {
            // 從頭到尾都沒變過的欄位不佔一列：矩陣的價值在於凸顯變化
            const values = rows.map((h) => h.CHANGES?.[field]);
            if (!values.some(Boolean)) return null;

            return (
              <TableRow key={field}>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', color: 'text.secondary', zIndex: 1 }}>
                  {CasePresenter.fieldLabel(field)}
                </TableCell>
                {rows.map((h) => {
                  const ch = h.CHANGES?.[field];

                  return (
                    <TableCell key={h.VERSION} align="center" sx={{ fontSize: 12 }}>
                      {ch ? (
                        <Stack spacing={0} alignItems="center">
                          <Typography variant="caption" sx={{ color: 'var(--c-error)', textDecoration: 'line-through', fontSize: 10 }}>
                            {CasePresenter.fieldValue(field, ch.from)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'var(--c-success)', fontSize: 11 }}>
                            {CasePresenter.fieldValue(field, ch.to)}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          ·
                        </Typography>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );

  return (
    <Dialog open={!!caseId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {TITLE[caseType] ?? '歷程'} · 共 {rows.length} 個版本
          </Typography>

          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
            <ToggleButton value="timeline">時間軸</ToggleButton>
            <ToggleButton value="matrix">欄位表</ToggleButton>
          </ToggleButtonGroup>

          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}

        {diff && (
          <Alert
            icon={<CompareArrowsIcon />}
            severity="info"
            sx={{ mb: 2 }}
            onClose={() => {
              setDiff(null);
              setCompare([]);
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              v{diff.from} → v{diff.to}
            </Typography>
            {Object.entries(diff.changes).length ? (
              Object.entries(diff.changes).map(([field, ch]) => (
                <Typography key={field} variant="caption" component="div">
                  · {CasePresenter.changeText(field, ch)}
                </Typography>
              ))
            ) : (
              <Typography variant="caption">兩版之間沒有差異</Typography>
            )}
          </Alert>
        )}

        {!rows.length && !loading ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            尚無歷程
          </Typography>
        ) : mode === 'timeline' ? (
          renderTimeline()
        ) : (
          renderMatrix()
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary">
          點版本號可勾選兩版比較。還原不會刪除任何版本 —— 它本身也會產生一筆新版本，
          所以「曾經被還原過」在稽核時看得到。
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
