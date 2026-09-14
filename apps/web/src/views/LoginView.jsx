import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useUser } from '../context/UserContext';

/** 登入頁 */
export default function LoginView() {
  const { login, expiredNotice, clearExpiredNotice } = useUser();
  const [form, setForm] = useState({ company: 'DEMO', account: 'admin', password: 'Demo1234' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await login(form.company, form.account, form.password);
    } catch (err) {
      // 後端刻意不區分「帳號不存在」與「密碼錯誤」，這裡照實顯示即可
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 400 }} component="form" onSubmit={handleSubmit}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            道路巡查 Demo
          </Typography>
          <Typography variant="body2" color="text.secondary">
            示範系統，資料皆為合成
          </Typography>
        </Stack>

        <Stack spacing={2}>
          <TextField
            label="公司代號"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            fullWidth
          />
          <TextField
            label="帳號"
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value })}
            fullWidth
          />
          <TextField
            label="密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            fullWidth
          />

          {expiredNotice && (
            <Alert severity="warning" onClose={clearExpiredNotice}>
              {expiredNotice}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? '登入中…' : '登入'}
          </Button>

          <Typography variant="caption" color="text.secondary">
            示範帳號：admin / inspector / worker1 / viewer，密碼皆為 Demo1234
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
