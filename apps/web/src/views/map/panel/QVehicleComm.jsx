import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import SettingsRemoteIcon from '@mui/icons-material/SettingsRemote';
import { fleetApi } from '../../../models/api/patrolApi';
import { VehicleCommPresenter } from '../../../presenters/VehicleCommPresenter';
import ConfirmDialog from '../../components/dialog/ConfirmDialog';

/** 車機狀態存在 Redis 且每幾秒就變，所以要輪詢；5 秒是「看得出在動」與「不吵」的折衷 */
const POLL_MS = 5000;

/**
 * 車機通訊。
 *
 * 這一頁回答的不是「車在哪裡」（那是車隊管理），而是
 * **「這台車機還活著嗎、我能不能叫得動它」**。
 *
 * 所以每一台顯示的第一行是結論而不是狀態碼：督導看到「故障碼 P0301」
 * 要做的事跟看到「心跳逾時」完全不同，而 `STREAMING` 這個字對他沒有意義。
 *
 * 指令是非同步的：送出之後等車機回 ack，逾時就說逾時 ——
 * 不會因為送出成功就顯示「已執行」。收訊差的地方那兩件事天天不一樣。
 */
export default function QVehicleComm() {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fleetApi.comm();
      setSessions((res.data ?? []).map((s) => VehicleCommPresenter.session(s)));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = useCallback(
    async (deviceId, action) => {
      setBusy(`${deviceId}:${action}`);
      setResult(null);
      try {
        const res = await fleetApi.command(deviceId, action);
        // 逾時不是成功也不是失敗 —— 指令送出去了，只是車機沒有回話
        setResult({
          level: res.data?.TIMED_OUT ? 'warning' : res.data?.OK ? 'success' : 'error',
          text: res.data?.TIMED_OUT
            ? `${deviceId} 未在時限內回應，指令可能沒有送達`
            : (res.data?.MESSAGE ?? res.message)
        });
      } catch (err) {
        setResult({ level: 'error', text: err.message });
      } finally {
        setBusy('');
        load();
      }
    },
    [load]
  );

  const commands = VehicleCommPresenter.commands();

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <SettingsRemoteIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          車機通訊
        </Typography>
        <Chip size="small" variant="outlined" label={`${sessions.length} 台連線`} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {result && (
        <Alert severity={result.level} sx={{ mb: 1.5 }} onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}

      {!sessions.length && !error && (
        <Alert severity="info">
          目前沒有車機連線。Demo 環境沒有真的車機，可以用 API 的「模擬車機連線」
          (<code>POST /fleet/comm/simulate</code>) 產生一台來看。
        </Alert>
      )}

      <Stack spacing={1.5} divider={<Divider flexItem />}>
        {sessions.map((s) => (
          <Box key={s.DEVICE_ID}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace', flex: 1 }}>
                {s.PLATE_NO}
              </Typography>
              <Chip
                size="small"
                label={s.verdict.text}
                color={s.verdict.level === 'success' ? 'success' : s.verdict.level}
                variant={s.verdict.level === 'success' ? 'outlined' : 'filled'}
              />
            </Stack>

            <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
              <Chip
                size="small"
                variant="outlined"
                label={s.streamLabel}
                sx={{ borderColor: s.streamColor, color: s.streamColor }}
              />
              {s.FRAMES > 0 && <Chip size="small" variant="outlined" label={`${s.FRAMES} 幀`} />}
              {s.streamStalled && <Chip size="small" color="warning" label="串流中但沒有影像" />}
              {s.engineOff && <Chip size="small" variant="outlined" label="可能已熄火" />}
              {s.silentText && <Chip size="small" color="warning" variant="outlined" label={s.silentText} />}
            </Stack>

            {VehicleCommPresenter.ecuRows(s.ECU).length > 0 && (
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
                {VehicleCommPresenter.ecuRows(s.ECU).map((r) => (
                  <Typography key={r.label} variant="caption" color="text.secondary">
                    {r.label} <strong>{r.text}</strong>
                  </Typography>
                ))}
              </Stack>
            )}

            <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {commands.map((c) => (
                <Tooltip key={c.key} title={c.hint}>
                  {/* span 包住是因為 disabled 的按鈕不會觸發 hover，提示就出不來 */}
                  <span>
                    <Button
                      size="small"
                      variant={c.danger ? 'outlined' : 'text'}
                      color={c.danger ? 'error' : 'primary'}
                      disabled={!s.CONTROLLABLE || Boolean(busy)}
                      onClick={() =>
                        c.danger ? setConfirm({ deviceId: s.DEVICE_ID, plate: s.PLATE_NO, cmd: c }) : send(s.DEVICE_ID, c.key)
                      }
                    >
                      {busy === `${s.DEVICE_ID}:${c.key}` ? '等待回應…' : c.label}
                    </Button>
                  </span>
                </Tooltip>
              ))}
            </Stack>

            {busy.startsWith(`${s.DEVICE_ID}:`) && <LinearProgress sx={{ mt: 0.8 }} />}
          </Box>
        ))}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        車機連線握手用的是設備金鑰，和使用者登入是兩條不同的連線。 狀態存在 Redis 不落地 —— 這些是「現在怎麼樣」，不是要留存的紀錄。
      </Typography>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`${confirm?.cmd.label}：${confirm?.plate}`}
        message={`${confirm?.cmd.hint}。這段時間的軌跡與案件都不會有，確定要送出嗎？`}
        confirmLabel="送出"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          send(confirm.deviceId, confirm.cmd.key);
          setConfirm(null);
        }}
      />
    </Paper>
  );
}
