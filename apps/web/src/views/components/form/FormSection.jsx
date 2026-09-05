import { Box, Stack, Typography } from '@mui/material';

/**
 * 分區表單。
 *
 * 派工單的欄位依表單類型而不同（PA 有刨鋪深度、PB 有取樣、PC/PD 只有回填），
 * 所以排版的單位是「區塊」而不是「欄位」—— 整區顯示或整區不顯示，
 * 而不是在一片欄位裡挑掉幾個。挑欄位的做法會讓格線出現空洞。
 *
 * 每區內用 auto-fit 格線：欄位少的區塊不會被拉開，欄位多的會自己換行。
 */
export function FormSection({ title, subtitle, children, minWidth = 300, dense = false }) {
  return (
    <Box sx={{ mb: dense ? 2 : 2.6 }}>
      <Stack
        direction="row"
        alignItems="baseline"
        spacing={1}
        sx={{ pb: 0.6, mb: 1.2, borderBottom: (t) => `1px solid ${t.palette.divider}` }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 1.2,
          gridTemplateColumns: { xs: '1fr', sm: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export default FormSection;
