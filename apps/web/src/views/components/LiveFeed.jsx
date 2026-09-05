import { Box, Chip, Paper, Stack, Typography, alpha } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { CasePresenter } from '../../presenters/CasePresenter';
import { DashboardPresenter } from '../../presenters/DashboardPresenter';

/** 即時案件流：WebSocket 推來的新案件插在最上面並標記 */
export default function LiveFeed({ rows = [], connected }) {
  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          即時案件
        </Typography>
        <Chip
          size="small"
          icon={<FiberManualRecordIcon sx={{ fontSize: 10 }} />}
          label={connected ? '已連線' : '連線中…'}
          color={connected ? 'success' : 'default'}
          variant="outlined"
        />
      </Stack>

      <Stack spacing={1} sx={{ overflowY: 'auto', flex: 1, minHeight: 0, pr: 0.5 }}>
        {rows.map((c) => (
          <Stack
            key={c.ID}
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{
              p: 1.2,
              borderRadius: 2,
              border: (t) => `1px solid ${t.palette.divider}`,
              bgcolor: (t) => (c.IS_NEW ? alpha(t.palette.primary.main, 0.1) : 'transparent')
            }}
          >
            <Box
              className={c.IS_NEW ? 'pulse-dot' : undefined}
              sx={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', color: DashboardPresenter.statusColor(c.NEED_REPAIR), bgcolor: 'currentColor', flexShrink: 0 }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {CasePresenter.crackLabel(c.CRACK_TYPE)} · {c.ROAD_NAME ?? '定位中…'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {c.CASE_NUM ?? c.EXTERNAL_ID}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {CasePresenter.time(c.DT_RECORD ?? c.DETECTED_AT)}
            </Typography>
          </Stack>
        ))}

        {!rows.length && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            尚無案件
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
