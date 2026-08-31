import { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import ImageViewer from '../image/ImageViewer';

/**
 * 表格裡的縮圖。
 *
 * 破壞案件的清單有二十幾個欄位，但承辦第一個看的是照片 ——
 * 「這是不是真的破壞」用看的比讀類型與尺寸快得多。
 *
 * 三個細節：
 *
 * 1. **點縮圖不會選到那一列**：`stopPropagation` —— 想看大圖的人不是想打開詳情。
 * 2. **載入失敗顯示佔位而不是破圖圖示**：簽名網址會過期，
 *    過期的圖示長得像「這筆資料壞了」，但其實只是網址老了。
 * 3. **大圖交給共用檢視器**：縮放、平移、鍵盤導覽只實作一次 ——
 *    表格、案件詳情、派工照片看到的是同一套操作。
 */
export default function ImageCell({ images = [], size = 46, alt = '預覽' }) {
  const list = images.filter((i) => i?.url);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState(false);

  if (!list.length) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }

  return (
    <>
      <Tooltip title={`${list.length > 1 ? `${list.length} 張 · ` : ''}點擊放大`}>
        <Box
          onClick={(e) => {
            e.stopPropagation();
            setIndex(0);
            setOpen(true);
          }}
          sx={{
            position: 'relative',
            width: size,
            height: size,
            borderRadius: 1,
            overflow: 'hidden',
            cursor: 'pointer',
            border: (t) => `1px solid ${t.palette.divider}`,
            bgcolor: 'action.hover',
            display: 'grid',
            placeItems: 'center',
            transition: 'transform .15s',
            '&:hover': { transform: 'scale(1.06)' }
          }}
        >
          {broken ? (
            <ImageNotSupportedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
          ) : (
            <Box
              component="img"
              src={list[0].url}
              alt={alt}
              loading="lazy"
              onError={() => setBroken(true)}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}

          {list.length > 1 && (
            <Box
              sx={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                px: 0.5,
                fontSize: 9,
                fontFamily: '"JetBrains Mono", monospace',
                color: '#fff',
                bgcolor: 'rgba(0,0,0,0.55)'
              }}
            >
              {list.length}
            </Box>
          )}
        </Box>
      </Tooltip>

      <ImageViewer open={open} images={list} initialIndex={index} onClose={() => setOpen(false)} />
    </>
  );
}
