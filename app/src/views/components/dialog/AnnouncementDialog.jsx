import { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { coreApi } from '../../../models/api/patrolApi';

const LEVEL = { INFO: '一般', WARNING: '注意', CRITICAL: '重要' };

/**
 * 系統公告。
 *
 * 有生效期間：過期的公告自動不再顯示，不需要有人記得去關掉 ——
 * 那件事一定會被忘記，然後上個月的維護公告會掛在畫面上三個月。
 */
export default function AnnouncementDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    setForm({
      TITLE: row?.TITLE ?? '',
      BODY: row?.BODY ?? '',
      LEVEL: row?.LEVEL ?? 'INFO',
      START_AT: row?.START_AT ? new Date(row.START_AT).toISOString().slice(0, 16) : '',
      END_AT: row?.END_AT ? new Date(row.END_AT).toISOString().slice(0, 16) : '',
      PINNED: row?.PINNED ?? false
    });
    setErrors({});
    setError('');
  }, [open, row]);

  const fields = [
    { key: 'TITLE', label: '標題', required: true, full: true },
    { key: 'LEVEL', label: '層級', type: 'select', required: true, options: Object.entries(LEVEL).map(([value, label]) => ({ value, label })) },
    { key: 'PINNED', label: '置頂且不可關閉', type: 'switch' },
    { key: 'START_AT', label: '開始顯示', type: 'datetime-local', hint: '不填則立即生效' },
    { key: 'END_AT', label: '結束顯示', type: 'datetime-local', hint: '不填則永久顯示' },
    { key: 'BODY', label: '內容', type: 'textarea', rows: 4, required: true }
  ];

  const submit = async () => {
    const next = {};
    if (!form.TITLE?.trim()) next.TITLE = '必填';
    if (!form.BODY?.trim()) next.BODY = '必填';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await coreApi.upsertAnnouncement({
        ID: row?.ID,
        TITLE: form.TITLE,
        BODY: form.BODY,
        LEVEL: form.LEVEL,
        START_AT: form.START_AT ? new Date(form.START_AT).toISOString() : undefined,
        END_AT: form.END_AT ? new Date(form.END_AT).toISOString() : undefined,
        PINNED: !!form.PINNED
      });
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
      title={row ? '編輯公告' : '發布公告'}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="info" sx={{ fontSize: 13 }}>
          停機維護、車機韌體更新、颱風停工 —— 只發群組訊息的話，沒看到的人就是沒看到。
        </Alert>

        <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
      </Stack>
    </FormDialog>
  );
}
