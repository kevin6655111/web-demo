import { useEffect, useRef, useState } from 'react';
import { Box, Paper, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/**
 * 數字從舊值滾到新值。
 *
 * 不是為了好看：看板上的數字每分鐘會刷新，直接跳掉的話，
 * 盯著看的人不會注意到它變了。滾動讓變化被看見。
 * 使用者若偏好減少動態效果，就直接顯示結果。
 */
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    fromRef.current = target;

    if (reduce || from === target) {
      setValue(target);
      return undefined;
    }

    const start = performance.now();
    let frame;

    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - p) ** 3; // ease-out：開頭快、結尾穩
      setValue(Math.round(from + (target - from) * eased));

      if (p < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

export default function KpiCard({ label, value, unit, tone = 'info', hint }) {
  const display = useCountUp(Number(value) || 0);

  // 取當前佈景的色值 —— 卡片要對它做透明度運算，CSS 變數在這裡行不通
  const theme = useTheme();
  const color = theme.palette[tone]?.main ?? theme.palette.info.main;

  return (
    <Paper
      sx={{
        p: 2.5,
        position: 'relative',
        overflow: 'hidden',
        transition: 'transform .18s ease, box-shadow .18s ease',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 10px 30px ${alpha(color, 0.13)}` },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(320px 120px at 100% 0%, ${alpha(color, 0.13)}, transparent 70%)`,
          pointerEvents: 'none'
        }
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {hint && (
          <Tooltip title={hint}>
            <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.6 }} />
          </Tooltip>
        )}
      </Stack>

      <Stack direction="row" alignItems="baseline" spacing={0.75}>
        <Typography
          sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 34, fontWeight: 700, color, lineHeight: 1 }}
        >
          {display}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {unit}
        </Typography>
      </Stack>

      <Box sx={{ mt: 1.5, height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${color}, transparent)` }} />
    </Paper>
  );
}
