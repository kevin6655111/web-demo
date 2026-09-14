import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Fab,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { supportApi } from '../../models/api/patrolApi';
import { useRealtime } from '../../hooks/useRealtime';
import { CasePresenter } from '../../presenters/CasePresenter';
import { useUser } from '../../context/UserContext';

const CATEGORIES = { ACCOUNT: '帳號', CASE: '案件', DEVICE: '車機設備', REPORT: '報表', OTHER: '其他' };
const STATE_LABEL = { OPEN: '待處理', ASSIGNED: '處理中', RESOLVED: '已解決', CLOSED: '已結案' };

/**
 * 客服即時聯絡。
 *
 * 做成浮動視窗而不是一個頁面：現場人員遇到問題時通常正在做別的事，
 * 要他離開當前畫面去開客服單，多數人會直接改打電話 ——
 * 那通電話的內容就不會留在系統裡。
 *
 * 客服端(有 SUPPORT.AGENT 權限)看到的是所有對話，使用者只看到自己那條。
 */
export default function SupportWidget() {
  const { user, can } = useUser();
  const isAgent = can('SUPPORT.AGENT');

  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState({ SUBJECT: '', CATEGORY: 'OTHER', BODY: '' });
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = isAgent ? await supportApi.threads({}) : await supportApi.myThreads();
      setThreads(res.data ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, [isAgent]);

  const loadMessages = useCallback(async (threadId) => {
    try {
      const res = await supportApi.messages(threadId);
      setMessages(res.data ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (open) loadThreads();
  }, [open, loadThreads]);

  useEffect(() => {
    if (active) loadMessages(active.ID);
  }, [active, loadMessages]);

  // 新訊息時捲到底：聊天視窗停在中間是最讓人困惑的狀態
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useRealtime({
    channels: ['support'],
    onMessage: useCallback(
      (msg) => {
        if (msg.type !== 'support.message') return;

        // 正在看的那條直接補上訊息，其餘只更新清單的未讀數
        if (active?.ID === msg.data.threadId) loadMessages(msg.data.threadId);
        loadThreads();
      },
      [active, loadMessages, loadThreads]
    )
  });

  const unread = threads.reduce((sum, t) => sum + (isAgent ? t.UNREAD_FOR_AGENT : t.UNREAD_FOR_USER), 0);

  const send = async () => {
    if (!draft.trim() || !active) return;

    try {
      await supportApi.send({ THREAD_ID: active.ID, BODY: draft });
      setDraft('');
      await loadMessages(active.ID);
    } catch (err) {
      setError(err.message);
    }
  };

  const openThread = async () => {
    if (!form.SUBJECT.trim() || !form.BODY.trim()) return;

    try {
      const res = await supportApi.open(form);
      setForm({ SUBJECT: '', CATEGORY: 'OTHER', BODY: '' });
      await loadThreads();
      setActive({ ID: res.data.ID, SUBJECT: form.SUBJECT, STATE: 'OPEN' });
    } catch (err) {
      setError(err.message);
    }
  };

  const take = async () => {
    try {
      await supportApi.update({ ID: active.ID, TAKE: true });
      await loadThreads();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open) {
    return (
      <Tooltip title={isAgent ? '客服後台' : '聯絡客服'} placement="left">
        <Badge badgeContent={unread} color="error" sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1200 }}>
          <Fab color="primary" size="medium" onClick={() => setOpen(true)}>
            <SupportAgentIcon />
          </Fab>
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Paper
      sx={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        width: { xs: 'calc(100% - 48px)', sm: 380 },
        height: 520,
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.2, borderBottom: (t) => `1px solid ${t.palette.divider}` }}
      >
        <SupportAgentIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {active ? active.SUBJECT : isAgent ? '客服後台' : '聯絡客服'}
        </Typography>

        {active && (
          <Button size="small" onClick={() => setActive(null)}>
            返回
          </Button>
        )}
        <IconButton size="small" onClick={() => setOpen(false)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}

      {/* ─── 對話清單 ─────────────────────────────────────── */}
      {!active && (
        <Stack sx={{ flex: 1, overflowY: 'auto', p: 1.5 }} spacing={1}>
          {threads.map((t) => {
            const badge = isAgent ? t.UNREAD_FOR_AGENT : t.UNREAD_FOR_USER;

            return (
              <Box
                key={t.ID}
                onClick={() => setActive(t)}
                sx={{
                  p: 1.3,
                  borderRadius: 2,
                  border: (t) => `1px solid ${t.palette.divider}`,
                  cursor: 'pointer',
                  '&:hover': { borderColor: 'primary.main' }
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }} noWrap>
                    {t.SUBJECT}
                  </Typography>
                  {badge > 0 && <Chip size="small" color="error" label={badge} sx={{ height: 18, fontSize: 10 }} />}
                </Stack>

                <Stack direction="row" spacing={0.5} sx={{ mt: 0.6 }} alignItems="center">
                  <Chip size="small" label={CATEGORIES[t.CATEGORY] ?? t.CATEGORY} sx={{ height: 18, fontSize: 10 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={STATE_LABEL[t.STATE] ?? t.STATE}
                    color={t.STATE === 'OPEN' ? 'warning' : t.STATE === 'RESOLVED' ? 'success' : 'default'}
                    sx={{ height: 18, fontSize: 10 }}
                  />
                  {isAgent && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {t.REQUESTER} · {t.AGENT ?? '未指派'}
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">
                    {CasePresenter.time(t.LAST_MESSAGE_AT ?? t.CREATED_AT)}
                  </Typography>
                </Stack>
              </Box>
            );
          })}

          {!threads.length && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {isAgent ? '目前沒有客服對話' : '尚未聯絡過客服'}
            </Typography>
          )}

          {/* 使用者才有「開新對話」；客服的工作是回覆，不是自己發問 */}
          {!isAgent && (
            <Stack spacing={1.2} sx={{ mt: 1, pt: 1.5, borderTop: (t) => `1px dashed ${t.palette.divider}` }}>
              <Typography variant="caption" color="text.secondary">
                有問題嗎？留言給客服
              </Typography>
              <TextField
                size="small"
                label="問題摘要"
                value={form.SUBJECT}
                onChange={(e) => setForm({ ...form, SUBJECT: e.target.value })}
              />
              <TextField
                select
                size="small"
                label="分類"
                value={form.CATEGORY}
                onChange={(e) => setForm({ ...form, CATEGORY: e.target.value })}
              >
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <MenuItem key={k} value={k}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="詳細說明"
                multiline
                rows={2}
                value={form.BODY}
                onChange={(e) => setForm({ ...form, BODY: e.target.value })}
              />
              <Button size="small" variant="contained" onClick={openThread}>
                送出
              </Button>
            </Stack>
          )}
        </Stack>
      )}

      {/* ─── 對話內容 ─────────────────────────────────────── */}
      {active && (
        <>
          <Stack sx={{ flex: 1, overflowY: 'auto', p: 1.5 }} spacing={1}>
            {isAgent && !active.AGENT && (
              <Button size="small" variant="outlined" onClick={take}>
                接手這條對話
              </Button>
            )}

            {messages.map((m) => {
              // 自己的訊息靠右：一眼看得出誰在說話，不必讀名字
              const mine = isAgent ? m.FROM_AGENT : !m.FROM_AGENT;

              return (
                <Stack key={m.ID} alignItems={mine ? 'flex-end' : 'flex-start'}>
                  <Box
                    sx={{
                      maxWidth: '82%',
                      px: 1.4,
                      py: 0.9,
                      borderRadius: 2,
                      bgcolor: mine ? 'action.selected' : 'action.hover',
                      border: '1px solid',
                      borderColor: mine ? 'primary.main' : 'divider'
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {m.BODY}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.2, fontSize: 10 }}>
                    {m.SENDER} · {CasePresenter.time(m.CREATED_AT)}
                  </Typography>
                </Stack>
              );
            })}

            <div ref={bottomRef} />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ p: 1.2, borderTop: (t) => `1px solid ${t.palette.divider}` }}>
            <TextField
              size="small"
              fullWidth
              placeholder="輸入訊息…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter 送出、Shift+Enter 換行：聊天視窗的通用習慣
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <IconButton color="primary" onClick={send} disabled={!draft.trim()}>
              <SendIcon />
            </IconButton>
          </Stack>
        </>
      )}
    </Paper>
  );
}
