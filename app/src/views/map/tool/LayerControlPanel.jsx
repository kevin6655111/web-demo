import { Box, Divider, IconButton, Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { useMapLayers } from '../../../context/MapContext';

/** 圖層分組的顯示順序與說明；沒列到的分組排在最後 */
const GROUP_ORDER = [
  { key: 'case', label: '案件', hint: '破壞案件點位' },
  { key: 'track', label: '軌跡', hint: '車輛行駛路徑' },
  { key: 'fleet', label: '車隊', hint: '車輛即時位置' },
  { key: 'road', label: '道路', hint: '路段評估與巡查計畫' },
  { key: 'survey', label: '調查', hint: '鋪面調查點' }
];

/**
 * 圖層控制。
 *
 * 對應 web_server 的 LayerControlPanel：分組、開關、透明度、聚焦。
 *
 * 「破壞案件」與「軌跡」能同時開，是這個面板存在的主要理由 ——
 * 巡查系統最常被問的是「這條軌跡有沒有經過那幾個坑洞」，
 * 那個問題需要兩個圖層疊在一起才回答得了。
 */
export default function LayerControlPanel() {
  const { layers, toggleLayer, setLayerOpacity, setLayerMode, fitTo } = useMapLayers();

  if (!layers.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        目前沒有圖層。切換上方的功能頁籤來載入資料。
      </Typography>
    );
  }

  const grouped = GROUP_ORDER.map((g) => ({ ...g, items: layers.filter((l) => l.group === g.key) })).filter((g) => g.items.length);

  const ungrouped = layers.filter((l) => !GROUP_ORDER.some((g) => g.key === l.group));
  if (ungrouped.length) grouped.push({ key: 'other', label: '其他', hint: '', items: ungrouped });

  return (
    <Stack spacing={2} sx={{ minWidth: 250 }}>
      {grouped.map((group, gi) => (
        <Box key={group.key}>
          <Stack direction="row" alignItems="baseline" spacing={0.8} sx={{ mb: 0.8 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {group.label}
            </Typography>
            {group.hint && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {group.hint}
              </Typography>
            )}
          </Stack>

          <Stack spacing={1.2}>
            {group.items.map((l) => (
              <Box key={l.key}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: l.color ?? 'primary.main', flexShrink: 0 }} />

                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {l.label}
                    {l.count !== undefined && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                        ({l.count})
                      </Typography>
                    )}
                  </Typography>

                  <Tooltip title="縮放到此圖層">
                    <span>
                      <IconButton size="small" disabled={!l.visible || !l.count} onClick={() => fitTo(l.key)}>
                        <CenterFocusStrongIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Switch size="small" checked={l.visible} onChange={() => toggleLayer(l.key)} />
                </Stack>

                {/* 只有點位圖層有三種畫法；線圖層切換聚合沒有意義 */}
                {l.visible && l.modes && (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    fullWidth
                    value={l.mode ?? 'point'}
                    onChange={(_, v) => v && setLayerMode(l.key, v)}
                    sx={{ mt: 0.6, '& .MuiToggleButton-root': { py: 0.2, fontSize: 10 } }}
                  >
                    {l.modes.map((m) => (
                      <ToggleButton key={m.value} value={m.value}>
                        {m.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                )}

                {l.visible && l.mode !== 'heat' && (
                  <Slider
                    size="small"
                    value={l.opacity ?? 1}
                    min={0.2}
                    max={1}
                    step={0.1}
                    onChange={(_, v) => setLayerOpacity(l.key, v)}
                    sx={{ mt: -0.2, py: 0.8 }}
                  />
                )}
              </Box>
            ))}
          </Stack>

          {gi < grouped.length - 1 && <Divider sx={{ mt: 1.5 }} />}
        </Box>
      ))}
    </Stack>
  );
}
