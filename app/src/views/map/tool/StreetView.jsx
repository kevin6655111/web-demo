import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, IconButton, Link, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

/**
 * 街景。
 *
 * 兩個來源，優先序有現實理由：
 *   Google 街景  涵蓋率最高，台灣的市區道路幾乎都有 —— 但**內嵌需要 API 金鑰**，
 *                沒設定金鑰時只能用免金鑰的外開連結(`map_action=pano`)
 *   Mapillary    群眾上傳、免費、可內嵌；巷弄與產業道路反而常常只有它有
 *
 * 所以預設走 Google：使用者要的是「看到那個路口長什麼樣」，
 * 涵蓋率比內嵌與否重要。查不到時再切 Mapillary。
 */

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '';
const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN ?? '';

export default function StreetView({ point, onClose }) {
  const [source, setSource] = useState('google');
  const [copied, setCopied] = useState(false);

  // 換點時回到預設來源：上一個點沒有 Google 街景不代表這一個也沒有
  useEffect(() => {
    setSource('google');
  }, [point?.lng, point?.lat]);

  const links = useMemo(() => {
    if (!point) return null;
    const { lng, lat } = point;

    return {
      googlePano: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
      googleEmbed: GOOGLE_KEY
        ? `https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_KEY}&location=${lat},${lng}&heading=${point.heading ?? 0}&pitch=0&fov=90`
        : null,
      mapillaryEmbed: `https://www.mapillary.com/embed?map_style=Mapillary%20streets&lat=${lat}&lng=${lng}&z=17&style=photo${
        MAPILLARY_TOKEN ? `&client_id=${MAPILLARY_TOKEN}` : ''
      }`,
      mapillaryOpen: `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17`,
      coord: `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    };
  }, [point]);

  if (!point || !links) return null;

  const embedUrl = source === 'google' ? links.googleEmbed : links.mapillaryEmbed;
  const openUrl = source === 'google' ? links.googlePano : links.mapillaryOpen;

  const copyCoord = async () => {
    try {
      await navigator.clipboard.writeText(links.coord);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 沒有剪貼簿權限時不吵使用者：座標本來就顯示在畫面上，可以自己選取
    }
  };

  return (
    <Paper
      sx={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        width: { xs: 'calc(100% - 24px)', sm: 460 },
        height: 320,
        zIndex: 1200,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderBottom: (t) => `1px solid ${t.palette.divider}` }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          街景
        </Typography>

        <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)} sx={{ height: 26 }}>
          <ToggleButton value="google" sx={{ px: 1, fontSize: 11 }}>
            Google
          </ToggleButton>
          <ToggleButton value="mapillary" sx={{ px: 1, fontSize: 11 }}>
            Mapillary
          </ToggleButton>
        </ToggleButtonGroup>

        <Tooltip title={copied ? '已複製' : '複製座標'}>
          <IconButton size="small" onClick={copyCoord}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="在新分頁開啟">
          <IconButton size="small" component="a" href={openUrl} target="_blank" rel="noopener">
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, position: 'relative' }}>
        {embedUrl ? (
          <iframe
            key={embedUrl}
            title="街景"
            src={embedUrl}
            style={{ border: 0, width: '100%', height: '100%' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          // 沒有金鑰就誠實說明，而不是給一個永遠轉圈的空框
          <Stack spacing={1.5} sx={{ p: 2, height: '100%', justifyContent: 'center' }}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Google 街景內嵌需要 Maps API 金鑰。設定 <code>VITE_GOOGLE_MAPS_KEY</code> 後即可直接內嵌；
              目前可用下方連結在新分頁開啟（免金鑰），或切換到 Mapillary 直接內嵌。
            </Alert>
            <Link href={links.googlePano} target="_blank" rel="noopener" variant="body2">
              在 Google 地圖開啟街景 →
            </Link>
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 0.8, borderTop: (t) => `1px solid ${t.palette.divider}` }}>
        <Chip size="small" label={links.coord} sx={{ height: 20, fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }} />
        {point.label && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {point.label}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
