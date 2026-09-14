import { useEffect, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import DownloadIcon from '@mui/icons-material/Download';
import ImageViewer from './ImageViewer';
import { extractZipImages, revokeImages } from '../../../models/utils/zipModel';

const MAX_MB = 20;

/**
 * 一格照片欄位：預覽、上傳、重傳、刪除。
 *
 * 一格對應一個照片類型（施工前、施工後…）—— 驗收時對照的是「階段」，
 * 所以格子是固定的，缺哪一格一眼看得出來，而不是「上傳了三張但不知道少哪張」。
 *
 * ZIP 類型另外處理：它裡面是一整批照片，縮圖沒有意義，
 * 給的是「下載」與「預覽」——預覽會在前端解開，直接進檢視器翻。
 */
export default function ImageSlot({ slot, canEdit = true, uploading = false, onPick, onRemove }) {
  const { TYPE: type, NAME: label, IS_ZIP: isZip, REQUIRED: required, UPLOADED: uploaded } = slot;

  const [viewerOpen, setViewerOpen] = useState(false);
  const [zipImages, setZipImages] = useState([]);
  const [zipLoading, setZipLoading] = useState(false);
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState('');

  // 換一張圖就重置破圖狀態，否則重傳成功後仍然顯示「載入失敗」
  useEffect(() => {
    setBroken(false);
  }, [uploaded?.URL]);

  // blob URL 用完要收：換幾張圖就多幾份留在記憶體裡
  useEffect(() => () => revokeImages(zipImages), [zipImages]);

  const pick = (file) => {
    if (!file) return;

    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`超過 ${MAX_MB}MB`);
      return;
    }

    setError('');
    onPick?.(type, file);
  };

  const openZip = async () => {
    if (zipImages.length) {
      setViewerOpen(true);
      return;
    }

    setZipLoading(true);
    setError('');

    try {
      const images = await extractZipImages(uploaded.URL);
      if (!images.length) {
        setError('壓縮檔裡沒有圖片');
        return;
      }

      setZipImages(images);
      setViewerOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setZipLoading(false);
    }
  };

  // 顏色只表達一件事：這一格「該有而沒有」還是「有了」。
  // 非必要且沒傳的用中性色，否則整頁會紅成一片，真正缺的反而看不出來
  const borderColor = uploaded ? 'success.main' : required ? 'error.main' : 'divider';

  return (
    <Box sx={{ border: 1, borderColor, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.6}
        sx={{ px: 1, py: 0.6, borderBottom: 1, borderColor: 'divider' }}
      >
        {isZip && <FolderZipIcon sx={{ fontSize: 15, color: 'text.secondary' }} />}
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }} noWrap>
          {label}
        </Typography>
        {required && (
          <Chip size="small" color="error" variant="outlined" label="必要" sx={{ height: 15, fontSize: 9 }} />
        )}
      </Stack>

      <Box
        sx={{
          position: 'relative',
          height: 118,
          display: 'grid',
          placeItems: 'center',
          cursor: canEdit ? 'pointer' : 'default',
          '&:hover .slot-actions': { opacity: 1 }
        }}
        onClick={() => {
          if (!uploaded && canEdit) document.getElementById(`slot-${type}`)?.click();
        }}
      >
        <input
          id={`slot-${type}`}
          hidden
          type="file"
          accept={isZip ? '.zip' : 'image/jpeg,image/png,image/heic,image/webp,image/svg+xml'}
          disabled={!canEdit}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            // 清掉 value：同一個檔案連選兩次不會觸發 change
            e.target.value = '';
          }}
        />

        {!uploaded && (
          <Stack alignItems="center" spacing={0.5} sx={{ color: 'text.disabled' }}>
            <UploadFileIcon fontSize="small" />
            <Typography variant="caption">{canEdit ? '點擊選擇檔案' : '尚未上傳'}</Typography>
          </Stack>
        )}

        {uploaded && isZip && (
          <Stack alignItems="center" spacing={1}>
            <FolderZipIcon sx={{ fontSize: 34, color: 'text.secondary' }} />
            <Stack direction="row" spacing={0.8}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                href={uploaded.URL}
                target="_blank"
                rel="noopener"
              >
                下載
              </Button>
              <Button size="small" variant="contained" disabled={zipLoading} onClick={openZip}>
                {zipLoading ? <CircularProgress size={14} /> : '預覽'}
              </Button>
            </Stack>
          </Stack>
        )}

        {uploaded && !isZip && !broken && (
          <Box
            component="img"
            src={uploaded.URL}
            alt={label}
            loading="lazy"
            onError={() => setBroken(true)}
            onClick={(e) => {
              e.stopPropagation();
              setViewerOpen(true);
            }}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
          />
        )}

        {uploaded && !isZip && broken && (
          <Typography variant="caption" color="text.disabled">
            圖片載入失敗（連結可能已過期）
          </Typography>
        )}

        {/* 動作列平常淡出：格子小，按鈕常駐會把圖蓋掉一半 */}
        {canEdit && uploaded && (
          <Stack
            className="slot-actions"
            direction="row"
            spacing={0.5}
            sx={{ position: 'absolute', top: 4, right: 4, opacity: 0, transition: 'opacity .15s' }}
          >
            <Tooltip title="重新選擇">
              <IconButton
                size="small"
                sx={{ bgcolor: 'background.paper' }}
                aria-label={`重傳 ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  document.getElementById(`slot-${type}`)?.click();
                }}
              >
                <UploadFileIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="刪除">
              <IconButton
                size="small"
                color="error"
                sx={{ bgcolor: 'background.paper' }}
                aria-label={`刪除 ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove?.(type);
                }}
              >
                <CloseIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        )}

        {uploading && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(15,23,42,0.35)'
            }}
          >
            <CircularProgress size={22} />
          </Box>
        )}
      </Box>

      <Typography
        variant="caption"
        sx={{ display: 'block', px: 1, py: 0.5, color: error ? 'error.main' : 'text.secondary', fontSize: 10 }}
        noWrap
      >
        {error ||
          (uploaded
            ? `${uploaded.IMG_NAME}（${Math.round((uploaded.SIZE_BYTES ?? 0) / 1024)} KB）`
            : isZip
              ? '壓縮檔，單檔上限 20MB'
              : '單檔上限 20MB')}
      </Typography>

      <ImageViewer
        open={viewerOpen}
        title={label}
        images={isZip ? zipImages : uploaded ? [{ url: uploaded.URL, title: label }] : []}
        onClose={() => setViewerOpen(false)}
      />
    </Box>
  );
}
