import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Checkbox, Chip, Divider, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { authApi } from '../../../models/api/patrolApi';

const FEATURE_LABEL = {
  CASE: '案件',
  WORK_ORDER: '派工',
  REPORT: '報表',
  DASHBOARD: '儀表板',
  FLEET: '車隊',
  TRACK: '軌跡',
  ROAD_EVAL: '道路評估',
  PROJECT: '標案',
  SURVEY: '鋪面調查',
  SUPPORT: '客服',
  TASK: '排程',
  ACCOUNT_MANAGE: '帳號管理'
};

const ACTION_LABEL = { READ: '檢視', CREATE: '新增', UPDATE: '修改', DELETE: '刪除', ACCEPT: '驗收', RUN: '執行', AGENT: '客服人員' };

/**
 * 角色權限。
 *
 * 用矩陣而不是一長串勾選框：權限有 12 個功能 × 最多 4 種動作，
 * 攤成一列會變成三十幾個並排的勾選框，沒有人分得出哪個對應哪個。
 *
 * 權限總表由後端提供 —— 前端寫死一份的話，後端新增功能時這裡就會漏掉。
 */
export default function RoleDialog({ open, row, onClose, onSaved }) {
  const [actionGroups, setActionGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState({ KEY: '', NAME: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const editing = !!row;

  useEffect(() => {
    if (!open) return;

    setSelected(row?.ACTIONS ?? []);
    setForm({ KEY: row?.KEY ?? '', NAME: row?.NAME ?? '' });
    setError('');

    authApi.actions().then((res) => setActionGroups(res.data ?? [])).catch((err) => setError(err.message));
  }, [open, row]);

  const toggle = (key) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const toggleGroup = (keys, allOn) => setSelected((prev) => (allOn ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]));

  const submit = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (editing) await authApi.updateRoleActions({ ID: row.ID, ACTIONS: selected });
      else await authApi.createRole({ KEY: form.KEY, NAME: form.NAME, ACTIONS: selected });

      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const total = useMemo(() => actionGroups.reduce((sum, g) => sum + g.ACTIONS.length, 0), [actionGroups]);

  return (
    <FormDialog
      open={open}
      title={editing ? '調整角色權限' : '新增角色'}
      subtitle={editing ? `${row.NAME}　目前 ${row.USER_COUNT} 人使用` : ''}
      maxWidth="md"
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
      extraActions={
        <Chip size="small" variant="outlined" label={`已選 ${selected.length} / ${total} 項`} sx={{ mr: 'auto' }} />
      }
    >
      <Stack spacing={2}>
        {editing ? (
          <Alert severity="warning" sx={{ fontSize: 13 }}>
            權限存在 JWT 內，調整後**不會立即生效** —— 要等使用者的 token 過期重取（預設 30 分鐘），
            或請他重新登入。這是拿「每次請求不用查資料庫」換來的。
          </Alert>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField size="small" label="角色代號" required value={form.KEY} onChange={(e) => setForm({ ...form, KEY: e.target.value })} placeholder="SUPERVISOR" />
            <TextField size="small" label="角色名稱" required value={form.NAME} onChange={(e) => setForm({ ...form, NAME: e.target.value })} placeholder="工地主任" />
          </Box>
        )}

        <Divider />

        <Stack spacing={1.5}>
          {actionGroups.map((g) => {
            const keys = g.ACTIONS.map((a) => a.KEY);
            const allOn = keys.every((k) => selected.includes(k));
            const someOn = keys.some((k) => selected.includes(k));

            return (
              <Box key={g.FEATURE} sx={{ p: 1.2, borderRadius: 2, border: (t) => `1px solid ${t.palette.divider}` }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Checkbox
                    size="small"
                    checked={allOn}
                    indeterminate={someOn && !allOn}
                    onChange={() => toggleGroup(keys, allOn)}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 90 }}>
                    {FEATURE_LABEL[g.FEATURE] ?? g.FEATURE}
                  </Typography>

                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
                    {g.ACTIONS.map((a) => (
                      <FormControlLabel
                        key={a.KEY}
                        sx={{ mr: 1 }}
                        control={<Checkbox size="small" checked={selected.includes(a.KEY)} onChange={() => toggle(a.KEY)} />}
                        label={<Typography variant="caption">{ACTION_LABEL[a.NAME] ?? a.NAME}</Typography>}
                      />
                    ))}
                  </Stack>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </FormDialog>
  );
}
