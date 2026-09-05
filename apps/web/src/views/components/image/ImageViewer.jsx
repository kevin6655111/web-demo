import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, Dialog, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/**
 * 圖片檢視器。
 *
 * 判讀破壞要看細節 —— 一張路面照，坑洞邊緣是不是真的破損，不放大看不出來。
 * 所以縮放與平移是這個元件的主功能，不是附加功能。
 *
 * **自己實作縮放而不是用放大鏡套件**：常見的 `react-image-magnifiers` 已經停更，
 * 而且它的模式是「滑鼠移到哪就放大哪」—— 手一離開就回到原狀，
 * 沒辦法「放大後停在那裡仔細看」。這裡用滾輪縮放 + 拖曳平移，倍率會留著。
 *
 * 鍵盤：← → 換圖、+ - 縮放、0 重置、Esc 關閉。
 * 審圖是連續動作，每張都要把滑鼠移到按鈕上點一次，一百張看下來手會廢掉。
 */
export default function ImageViewer({ open, images = [], initialIndex = 0, title, onClose }) {
  const list = useMemo(() => images.filter((i) => i?.url), [images]);

  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const boxRef = useRef(null);

  const current = list[Math.min(index, Math.max(0, list.length - 1))];

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!open) return;

    setIndex(initialIndex);
    reset();
  }, [open, initialIndex, reset]);

  // 換圖要把縮放歸零：停在上一張的放大位置看下一張，看到的是完全不相干的一角
  const go = useCallback(
    (delta) => {
      if (list.length < 2) return;

      setIndex((i) => (i + delta + list.length) % list.length);
      reset();
    },
    [list.length, reset]
  );

  const zoomBy = useCallback((factor, origin) => {
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));

      // 縮到底就把位移歸零，否則圖會卡在畫面外回不來
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      else if (origin) {
        // 以游標為中心縮放：不然放大時想看的那個點會跑掉
        setOffset((o) => ({ x: o.x - origin.x * (next / prev - 1), y: o.y - origin.y * (next / prev - 1) }));
      }

      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      const map = {
        ArrowLeft: () => go(-1),
        ArrowRight: () => go(1),
        Escape: () => onClose?.(),
        '+': () => zoomBy(1.4),
        '=': () => zoomBy(1.4),
        '-': () => zoomBy(1 / 1.4),
        0: reset
      };

      const fn = map[e.key];
      if (!fn) return;

      e.preventDefault();
      fn();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go, onClose, zoomBy, reset]);

  // 滾輪縮放要擋掉頁面捲動，而 React 的 onWheel 是被動監聽，preventDefault 無效
  useEffect(() => {
    const node = boxRef.current;
    if (!open || !node) return undefined;

    const onWheel = (e) => {
      e.preventDefault();

      const rect = node.getBoundingClientRect();
      const origin = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };

      zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, origin);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [open, zoomBy]);

  const startDrag = (e) => {
    if (scale <= MIN_SCALE) return;

    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onMove = (e) => {
    if (!dragging) return;

    setOffset({ x: dragRef.current.ox + (e.clientX - dragRef.current.x), y: dragRef.current.oy + (e.clientY - dragRef.current.y) });
  };

  const heading = current?.title ?? title ?? '檢視圖片';

  if (!open || !current) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'rgba(2,6,23,0.96)' } }}
      // React 的 portal 事件是沿「元件樹」冒泡，不是 DOM 樹 ——
      // 這個檢視器常常由表格列裡的縮圖算繪，不擋的話，
      // 在檢視器裡按任何一個按鈕都會順便觸發那一列的 onClick(打開詳情)。
      // 症狀是「按放大結果跳出別的視窗」，而且完全看不出關聯
      onClick={(e) => e.stopPropagation()}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.2, color: '#e2e8f0' }}>
          <Typography sx={{ fontWeight: 600 }}>{heading}</Typography>

          {list.length > 1 && (
            <Chip
              size="small"
              variant="outlined"
              label={`${index + 1} / ${list.length}`}
              sx={{ color: '#e2e8f0', borderColor: 'rgba(226,232,240,0.4)' }}
            />
          )}

          <Chip size="small" variant="outlined" label={`${Math.round(scale * 100)}%`} sx={{ color: '#e2e8f0', borderColor: 'rgba(226,232,240,0.4)' }} />

          <Box sx={{ flex: 1 }} />

          <Tooltip title="縮小 (-)">
            <IconButton size="small" sx={{ color: '#e2e8f0' }} aria-label="縮小" onClick={() => zoomBy(1 / 1.4)}>
              <ZoomOutIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="放大 (+)">
            <IconButton size="small" sx={{ color: '#e2e8f0' }} aria-label="放大" onClick={() => zoomBy(1.4)}>
              <ZoomInIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="重置 (0)">
            <IconButton size="small" sx={{ color: '#e2e8f0' }} aria-label="重置縮放" onClick={reset}>
              <RestartAltIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="下載">
            <IconButton size="small" sx={{ color: '#e2e8f0' }} aria-label="下載" component="a" href={current.url} target="_blank" rel="noopener">
              <DownloadIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="關閉 (Esc)">
            <IconButton size="small" sx={{ color: '#e2e8f0' }} aria-label="關閉" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box
          ref={boxRef}
          onMouseDown={startDrag}
          onMouseMove={onMove}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
          onDoubleClick={() => (scale > MIN_SCALE ? reset() : zoomBy(2.5))}
          sx={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            cursor: scale > MIN_SCALE ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            userSelect: 'none'
          }}
        >
          <Box
            component="img"
            src={current.url}
            alt={heading}
            draggable={false}
            sx={{
              maxWidth: '94vw',
              maxHeight: 'calc(100vh - 200px)',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              // 拖曳時不要有過場動畫，否則游標與圖會分家
              transition: dragging ? 'none' : 'transform .12s ease-out',
              imageRendering: scale > 3 ? 'pixelated' : 'auto'
            }}
          />

          {list.length > 1 && (
            <>
              <IconButton
                aria-label="上一張"
                onClick={() => go(-1)}
                sx={{ position: 'absolute', left: 12, color: '#e2e8f0', bgcolor: 'rgba(15,23,42,0.55)' }}
              >
                <KeyboardArrowLeftIcon />
              </IconButton>
              <IconButton
                aria-label="下一張"
                onClick={() => go(1)}
                sx={{ position: 'absolute', right: 12, color: '#e2e8f0', bgcolor: 'rgba(15,23,42,0.55)' }}
              >
                <KeyboardArrowRightIcon />
              </IconButton>
            </>
          )}
        </Box>

        {/* 縮圖列：一組照片(原始 / 判讀 / 施工前後)要能直接跳，而不是一張一張按 */}
        {list.length > 1 && (
          <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.2, overflowX: 'auto' }}>
            {list.map((img, i) => (
              <Box
                key={img.url}
                onClick={() => {
                  setIndex(i);
                  reset();
                }}
                sx={{
                  width: 84,
                  height: 54,
                  flexShrink: 0,
                  borderRadius: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  opacity: i === index ? 1 : 0.5,
                  outline: i === index ? '2px solid #38bdf8' : '1px solid rgba(226,232,240,0.25)'
                }}
              >
                <Box component="img" src={img.url} alt={img.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </Box>
            ))}
          </Stack>
        )}

        <Typography variant="caption" sx={{ px: 2, pb: 1.2, color: 'rgba(226,232,240,0.6)' }}>
          滾輪縮放 · 拖曳平移 · 雙擊切換 · ← → 換圖 · 0 重置 · Esc 關閉
        </Typography>
      </Stack>
    </Dialog>
  );
}
