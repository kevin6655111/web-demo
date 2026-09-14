import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Checkbox, Chip, FormControlLabel, Stack, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { companyApi } from '../../../models/api/patrolApi';

const TIER_NAME = { 1: '平台管理', 2: '廠商單位', 3: '外包單位' };

/** 動作鍵分組：`MODULE.ACTION` 的前綴就是模組 */
const MODULE_LABEL = {
  CASE: '案件',
  WORK_ORDER: '派工',
  REPORT: '報表',
  FLEET: '車輛',
  TRACK: '軌跡',
  ROAD_EVAL: '道路評估',
  PROJECT: '標案',
  SURVEY: '鋪面調查',
  SUPPORT: '客服',
  DASHBOARD: '儀表板',
  TASK: '排程',
  ACCOUNT: '帳號管理',
  SYSTEM: '系統'
};

const ACTION_LABEL = {
  READ: '檢視',
  CREATE: '新增',
  UPDATE: '修改',
  DELETE: '刪除',
  ACCEPT: '驗收',
  RUN: '執行',
  AGENT: '客服身分',
  AUDIT: '稽核'
};

/**
 * 下層單位：建立與授權開通。
 *
 * 權限矩陣只列出**自己有的**動作 —— 開不出去的東西不該出現在畫面上。
 * 點得到卻開不成，是最糟的介面。
 *
 * 開通是「上限」而不是使用者的權限：下層仍要自己設計角色，
 * 而角色設計不出這裡沒勾的功能。
 */
export default function CompanyDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [grantable, setGrantable] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const editing = !!row;

  useEffect(() => {
    if (!open) return;

    setForm(
      row
        ? { NAME: row.NAME, USER_LIMIT: row.USER_LIMIT, DESCRIPTION: row.DESCRIPTION ?? '', IS_ACTIVE: row.IS_ACTIVE }
        : { CODE: '', NAME: '', USER_LIMIT: 10, DESCRIPTION: '' }
    );
    setErrors({});
    setError('');

    // 我能開通的上限；矩陣只畫這些
    companyApi
      .grantable()
      .then((res) => setGrantable(res.data?.ACTIONS ?? []))
      .catch(() => setGrantable([]));

    if (row) {
      companyApi
        .grants(row.ID)
        .then((res) =>
          setSelected(new Set((res.data?.GRANTS ?? []).filter((g) => g.IS_ACTIVE).map((g) => g.ACTION_KEY)))
        )
        .catch(() => setSelected(new Set()));
    } else {
      setSelected(new Set());
    }
  }, [open, row]);

  const grouped = useMemo(() => {
    const map = new Map();

    for (const key of grantable) {
      const [mod] = key.split('.');
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod).push(key);
    }

    return [...map.entries()];
  }, [grantable]);

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleModule = (keys) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const createFields = [
    { key: 'CODE', label: '單位代碼', required: true, placeholder: 'SUB02', hint: '登入時要輸入的那一個' },
    { key: 'NAME', label: '單位名稱', required: true },
    { key: 'USER_LIMIT', label: '人員額度', type: 'number', hint: '開通模組卻不限人數等於沒有限制' },
    { key: 'DESCRIPTION', label: '說明', full: true }
  ];

  const editFields = [
    { key: 'NAME', label: '單位名稱', required: true },
    { key: 'USER_LIMIT', label: '人員額度', type: 'number', hint: '不可小於現有人數' },
    { key: 'DESCRIPTION', label: '說明', full: true },
    { key: 'IS_ACTIVE', label: '啟用（停用後底下所有帳號一起登不進來）', type: 'switch', full: true }
  ];

  const submit = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (editing) {
        const next = {};
        if (!form.NAME?.trim()) next.NAME = '必填';
        if (Object.keys(next).length) {
          setErrors(next);
          setSubmitting(false);
          return;
        }

        await companyApi.update({
          ID: row.ID,
          NAME: form.NAME,
          USER_LIMIT: Number(form.USER_LIMIT),
          DESCRIPTION: form.DESCRIPTION || undefined,
          IS_ACTIVE: !!form.IS_ACTIVE
        });

        // 送的是完整清單而不是增量：畫面上勾選的本來就是完整狀態
        await companyApi.setGrants({ COMPANY_ID: row.ID, ACTIONS: [...selected] });
      } else {
        const next = {};
        if (!form.CODE?.trim()) next.CODE = '必填';
        if (!form.NAME?.trim()) next.NAME = '必填';
        if (Object.keys(next).length) {
          setErrors(next);
          setSubmitting(false);
          return;
        }

        await companyApi.create({
          CODE: form.CODE,
          NAME: form.NAME,
          USER_LIMIT: Number(form.USER_LIMIT) || 10,
          DESCRIPTION: form.DESCRIPTION || undefined,
          ACTIONS: [...selected]
        });
      }

      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title={editing ? `${row.NAME}　權限開通` : '新增下層單位'}
      subtitle={
        editing
          ? `${row.CODE}　${TIER_NAME[row.TIER] ?? ''}　已開通 ${selected.size} 項`
          : '只能建立比自己低一層的單位；開通內容必須是自己有的子集'
      }
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <FormFields fields={editing ? editFields : createFields} value={form} errors={errors} onChange={setForm} />

        <Alert severity="info" sx={{ fontSize: 13 }}>
          開通的是**上限**，不是使用者的權限 —— 下層仍要自己設計角色，
          但角色設計不出這裡沒勾的功能。收回時，下層已經再開出去的那一份也會一起收回。
        </Alert>

        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">開通權限</Typography>
            <Chip size="small" label={`${selected.size} / ${grantable.length}`} variant="outlined" />
            <Typography variant="caption" color="text.secondary">
              只列出你自己有的動作
            </Typography>
          </Stack>

          <Stack spacing={0.5}>
            {grouped.map(([mod, keys]) => (
              <Box
                key={mod}
                sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1.5, px: 1.2, py: 0.6 }}
              >
                <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap>
                  <FormControlLabel
                    sx={{ minWidth: 130, mr: 1 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={keys.every((k) => selected.has(k))}
                        indeterminate={keys.some((k) => selected.has(k)) && !keys.every((k) => selected.has(k))}
                        onChange={() => toggleModule(keys)}
                      />
                    }
                    label={
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {MODULE_LABEL[mod] ?? mod}
                      </Typography>
                    }
                  />

                  {keys.map((key) => (
                    <FormControlLabel
                      key={key}
                      control={<Checkbox size="small" checked={selected.has(key)} onChange={() => toggle(key)} />}
                      label={
                        <Typography variant="caption">
                          {ACTION_LABEL[key.split('.')[1]] ?? key.split('.')[1]}
                        </Typography>
                      }
                    />
                  ))}
                </Stack>
              </Box>
            ))}

            {!grouped.length && (
              <Typography variant="body2" color="text.disabled">
                你目前沒有可以再往下開通的權限。
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
    </FormDialog>
  );
}
