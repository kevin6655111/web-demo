import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Stack, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { caseApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { useRealtime } from '../../../hooks/useRealtime';
import { useUser } from '../../../context/UserContext';

/**
 * 案件討論串。
 *
 * 訊息落地資料庫而不是只靠 WebSocket 廣播：
 * 現場師傅在隧道裡斷線三分鐘，回來時要看得到這段時間辦公室說了什麼。
 *
 * 進房時由 WebSocket 自動回補歷史訊息，這裡另外打一次 HTTP ——
 * 兩者都要：HTTP 保證「一定看得到現在的樣子」，WebSocket 負責「之後的變化」。
 */
export default function CaseChatPanel({ caseId }) {
  const { user } = useUser();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await caseApi.messages(caseId);
      setMessages(res.data ?? []);
    } catch {
      setMessages([]);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const { send } = useRealtime({
    channels: ['case'],
    onMessage: useCallback(
      (msg) => {
        if (msg.type === 'chat.message' && msg.data.CASE_ID === caseId) {
          setMessages((prev) => (prev.some((m) => m.ID === msg.data.ID) ? prev : [...prev, msg.data]));
        }
        if (msg.type === 'chat.history' && msg.data.caseId === caseId) {
          setMessages(msg.data.messages ?? []);
        }
      },
      [caseId]
    )
  });

  // 進出討論串：後端用它決定要把訊息推給誰，也順帶記錄「誰正在看這個案件」
  useEffect(() => {
    send({ type: 'case.enter', caseId });
    return () => send({ type: 'case.leave', caseId });
  }, [caseId, send]);

  const submit = () => {
    if (!draft.trim()) return;

    send({ type: 'chat.send', caseId, body: draft });
    setDraft('');
  };

  return (
    <Stack sx={{ height: 340 }}>
      <Stack spacing={1} sx={{ flex: 1, overflowY: 'auto', pr: 0.5 }}>
        {messages.map((m) => {
          const mine = m.SENDER_UID === user.uid;

          return (
            <Stack key={m.ID} alignItems={mine ? 'flex-end' : 'flex-start'}>
              <Box
                sx={{
                  maxWidth: '80%',
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
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mt: 0.2 }}>
                {m.SENDER} · {CasePresenter.time(m.CREATED_AT)}
              </Typography>
            </Stack>
          );
        })}

        {!messages.length && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            還沒有討論。現場與辦公室的溝通留在這裡，斷線也不會漏掉。
          </Typography>
        )}

        <div ref={bottomRef} />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ pt: 1.5 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="輸入訊息…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <IconButton color="primary" onClick={submit} disabled={!draft.trim()}>
          <SendIcon />
        </IconButton>
      </Stack>
    </Stack>
  );
}
