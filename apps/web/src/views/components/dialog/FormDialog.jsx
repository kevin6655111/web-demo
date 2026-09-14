import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

/**
 * 表單對話框的外框。
 *
 * 抽出來的理由：這個系統有九種表單，每種都要處理「儲存中要鎖住按鈕、
 * 錯誤要顯示在表單上方、取消要能關掉」。各寫一次的話，
 * 總有幾個表單會在儲存中讓人按第二次 —— 然後就建立了兩筆資料。
 */
export default function FormDialog({
  open,
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel = '儲存',
  submitting = false,
  error = '',
  onErrorClose,
  disabled = false,
  maxWidth = 'sm',
  extraActions,
  children
}) {
  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth={maxWidth} fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="flex-start" spacing={2}>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6">{title}</Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Stack>

          <IconButton size="small" aria-label="關閉" onClick={onClose} disabled={submitting}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onErrorClose}>
            {error}
          </Alert>
        )}

        {children}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {extraActions}
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          {onSubmit && (
            <Button
              variant="contained"
              onClick={onSubmit}
              // 儲存中一律鎖住：沒鎖的話按兩次就是兩筆資料
              disabled={submitting || disabled}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting ? '儲存中…' : submitLabel}
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
