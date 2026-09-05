import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

/**
 * 二次確認。
 *
 * 只用在**不可復原**的操作上（刪除、退回重做、停用帳號）。
 * 對可以復原的操作也跳確認，會讓人養成閉著眼睛按確定的習慣 ——
 * 然後真正危險的那一次也照按。
 */
export default function ConfirmDialog({ open, title, message, confirmLabel = '確定', danger = false, onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ whiteSpace: 'pre-wrap' }}>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
