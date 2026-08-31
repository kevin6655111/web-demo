import { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { authApi } from '../../../models/api/patrolApi';

/**
 * 帳號。
 *
 * 密碼規則刻意不嚴苛：至少 8 碼、混合兩種字元類型、不可包含帳號。
 * 強制符號與定期更換會把人逼去寫便利貼，實務上更不安全
 * （NIST SP 800-63B 的結論也是如此）。
 */
export default function UserDialog({ open, row, roles = [], onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const editing = !!row;

  useEffect(() => {
    if (!open) return;

    setForm(editing ? { ACTIVE: row.ACTIVE } : { ACCOUNT: '', USER_NAME: '', PASSWORD: '', ROLE_KEY: '' });
    setErrors({});
    setError('');
  }, [open, row, editing]);

  const createFields = [
    { key: 'ACCOUNT', label: '帳號', required: true, placeholder: 'inspector02' },
    { key: 'USER_NAME', label: '姓名', required: true },
    { key: 'PASSWORD', label: '密碼', type: 'password', required: true, hint: '至少 8 碼、混合字母與數字、不可包含帳號' },
    { key: 'ROLE_KEY', label: '角色', type: 'select', required: true, options: roles.map((r) => ({ value: r.KEY, label: r.NAME })) }
  ];

  const editFields = [{ key: 'ACTIVE', label: '啟用此帳號', type: 'switch', full: true }];

  const submit = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (editing) {
        await authApi.setActive({ ID: row.ID, ACTIVE: !!form.ACTIVE });
      } else {
        const next = {};
        if (!form.ACCOUNT?.trim()) next.ACCOUNT = '必填';
        if (!form.USER_NAME?.trim()) next.USER_NAME = '必填';
        if (!form.ROLE_KEY) next.ROLE_KEY = '必填';
        if (!form.PASSWORD || form.PASSWORD.length < 8) next.PASSWORD = '至少 8 碼';
        if (Object.keys(next).length) {
          setErrors(next);
          setSubmitting(false);
          return;
        }

        await authApi.createAccount(form);
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
      title={editing ? '帳號設定' : '新增帳號'}
      subtitle={editing ? `${row.ACCOUNT}　${row.USER_NAME}` : ''}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        {editing && (
          <Alert severity="info" sx={{ fontSize: 13 }}>
            停用後該帳號無法登入，但既有的 token 要等過期才失效（預設 30 分鐘）。
          </Alert>
        )}

        <FormFields fields={editing ? editFields : createFields} value={form} errors={errors} onChange={setForm} />
      </Stack>
    </FormDialog>
  );
}
