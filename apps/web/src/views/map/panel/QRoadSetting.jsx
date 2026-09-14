import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import QueryForm from '../../components/query/QueryForm';
import { roadSettingApi } from '../../../models/api/patrolApi';
import { RoadSettingPresenter } from '../../../presenters/RoadSettingPresenter';
import { useMapLayers } from '../../../context/MapContext';
import { useQueryOptions } from '../../../hooks/useQueryOptions';
import { useUser } from '../../../context/UserContext';

/**
 * 道路設定。
 *
 * 圖資直接拿來用是不行的，這個面板解決三件事：
 *   **命名**   相當比例的線段沒有路名，圖台上是一堆無名的線
 *   **管轄**   市府、公所、公路單位的路混在一起，巡查標案只負責一部分
 *   **納入**   施工中或私人道路要排除，否則覆蓋率的分母永遠是錯的
 *
 * 操作是批次的：一條一條點的話，「把這個里的巷弄全部排除」要按上百次。
 * 選取靠清單而不是在地圖上框選 —— 框選需要一整套繪圖互動，
 * 而清單同時看得到名稱與管轄，判斷起來反而快。
 */
export default function QRoadSetting() {
  const { can } = useUser();
  const { registerLayer } = useMapLayers();
  const queryOptions = useQueryOptions();

  const [mode, setMode] = useState('line');
  const [form, setForm] = useState({});
  const [lines, setLines] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [rename, setRename] = useState({ id: null, value: '' });
  const [jurisdiction, setJurisdiction] = useState('CITY');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    async (query) => {
      try {
        const params = { ...query };
        for (const [k, v] of Object.entries(params)) if (Array.isArray(v)) params[k] = v.join(',');

        if (mode === 'line') {
          const res = await roadSettingApi.lines(params);
          const features = res.data?.features ?? [];
          setLines(features);

          registerLayer('roadLine', {
            group: 'road',
            type: 'line',
            label: '道路線段',
            color: 'var(--c-info)',
            // 排除的線段畫成灰色，其餘依管轄上色 —— 設定畫面的重點是
            // 「哪些還沒設定好」，顏色要直接回答那個問題
            colorOf: RoadSettingPresenter.lineColor,
            count: features.length,
            data: features,
            order: 5,
            bounds: () => features.flatMap((f) => f.geometry.coordinates.map(([lng, lat]) => [lat, lng]))
          });
        } else {
          const res = await roadSettingApi.blocks(params);
          const features = res.data?.features ?? [];
          setBlocks(features);

          registerLayer('roadBlock', {
            group: 'road',
            type: 'polygon',
            label: '道路區塊',
            color: 'var(--c-muted)',
            colorOf: (p) => RoadSettingPresenter.blockStatusColor(p.status),
            count: features.length,
            data: features,
            order: 4,
            bounds: () => features.flatMap((f) => f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]))
          });
        }

        setSelected(new Set());
      } catch (err) {
        setError(err.message);
      }
    },
    [mode, registerLayer]
  );

  useEffect(() => {
    load(form);
    // 切換線段／區塊時重查；查詢條件是共用的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const rows = mode === 'line' ? lines : blocks;

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const act = async (fn, successMessage) => {
    try {
      const res = await fn();
      setNotice(successMessage ?? res.message);
      await load(form);
    } catch (err) {
      setError(err.message);
    }
  };

  const fields = useMemo(
    () => [
      { key: 'ROAD_NAME', label: '路名', width: 140 },
      {
        key: 'DISTRICT',
        label: '行政區',
        type: 'multi',
        options: (queryOptions.districts ?? []).map((d) => ({ value: d.DISTRICT, label: d.DISTRICT }))
      },
      ...(mode === 'line'
        ? [
            {
              key: 'JURISDICTION',
              label: '管轄',
              type: 'multi',
              options: RoadSettingPresenter.jurisdictionOptions()
            },
            {
              key: 'IS_ACTIVE',
              label: '巡查範圍',
              type: 'select',
              options: [
                { value: 'true', label: '納入' },
                { value: 'false', label: '排除' }
              ]
            },
            { key: 'UNNAMED_ONLY', label: '只看無名', type: 'select', options: [{ value: 'true', label: '是' }] }
          ]
        : [
            { key: 'BLOCK_TYPE', label: '類型', type: 'multi', options: RoadSettingPresenter.blockTypeOptions() },
            { key: 'STATUS', label: '設定狀態', type: 'multi', options: RoadSettingPresenter.blockStatusOptions() }
          ])
    ],
    [mode, queryOptions]
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={mode}
        onChange={(_, v) => v && setMode(v)}
        sx={{ '& .MuiToggleButton-root': { py: 0.4, textTransform: 'none' } }}
      >
        <ToggleButton value="line">線段（歸屬與範圍）</ToggleButton>
        <ToggleButton value="block">區塊（面積與類型）</ToggleButton>
      </ToggleButtonGroup>

      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={() => load(form)}
        onReset={() => {
          setForm({});
          load({});
        }}
        dense
      />

      {notice && (
        <Alert severity="success" onClose={() => setNotice('')} sx={{ fontSize: 13 }}>
          {notice}
        </Alert>
      )}

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {mode === 'line' ? '道路線段' : '道路區塊'} {rows.length}
          </Typography>
          {selected.size > 0 && <Chip size="small" color="primary" label={`已選 ${selected.size}`} />}
        </Stack>

        {can('ROAD_SETTING.UPDATE') && selected.size > 0 && (
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            {mode === 'line' ? (
              <>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => act(() => roadSettingApi.setLinesActive([...selected], true))}
                  >
                    納入巡查
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    onClick={() => act(() => roadSettingApi.setLinesActive([...selected], false, '施工中，本季不巡'))}
                  >
                    排除
                  </Button>
                </Stack>

                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="管轄單位"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    sx={{ minWidth: 130 }}
                  >
                    {RoadSettingPresenter.jurisdictionOptions().map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button size="small" onClick={() => act(() => roadSettingApi.setJurisdiction([...selected], jurisdiction))}>
                    套用管轄
                  </Button>
                </Stack>
              </>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => act(() => roadSettingApi.updateBlocks({ IDS: [...selected], STATUS: 1 }))}
                >
                  納入巡查
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => act(() => roadSettingApi.updateBlocks({ IDS: [...selected], STATUS: 2 }))}
                >
                  不納入
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={() => act(() => roadSettingApi.updateBlocks({ IDS: [...selected], STATUS: 3 }))}
                >
                  施工中
                </Button>
              </Stack>
            )}
          </Stack>
        )}

        <Divider sx={{ mb: 1 }} />

        <Stack spacing={0.6} sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {rows.map((f) => {
            const p = f.properties;
            const isSelected = selected.has(p.id);

            return (
              <Box
                key={p.id}
                onClick={() => toggle(p.id)}
                sx={{
                  p: 1,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  border: (t) => `1px solid ${isSelected ? t.palette.primary.main : t.palette.divider}`,
                  bgcolor: isSelected ? 'action.selected' : 'transparent'
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.8}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {mode === 'line' ? p.label : p.roadName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {p.code}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={0.5} sx={{ mt: 0.4 }} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={p.district ?? '未分區'} sx={{ height: 18, fontSize: 10 }} />
                  {mode === 'line' ? (
                    <>
                      <Chip
                        size="small"
                        label={RoadSettingPresenter.jurisdictionLabel(p.jurisdiction)}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                      <Chip
                        size="small"
                        label={p.isActive ? '納入' : '排除'}
                        color={p.isActive ? 'success' : 'default'}
                        variant="outlined"
                        sx={{ height: 18, fontSize: 10 }}
                      />
                      <Chip size="small" label={`${Math.round(p.lengthM)} m`} sx={{ height: 18, fontSize: 10 }} />
                    </>
                  ) : (
                    <>
                      <Chip
                        size="small"
                        label={RoadSettingPresenter.blockTypeLabel(p.blockType)}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                      <Chip
                        size="small"
                        label={RoadSettingPresenter.blockStatusLabel(p.status)}
                        variant="outlined"
                        sx={{ height: 18, fontSize: 10 }}
                      />
                      <Chip size="small" label={`${Math.round(p.areaM2 ?? 0)} m²`} sx={{ height: 18, fontSize: 10 }} />
                    </>
                  )}
                </Stack>

                {/* 無名路段就地命名：名字是看著地圖一條一條打的，不做批次 */}
                {mode === 'line' && can('ROAD_SETTING.UPDATE') && !p.displayName && !p.roadName && (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.8 }} onClick={(e) => e.stopPropagation()}>
                    <TextField
                      size="small"
                      placeholder="輸入路名"
                      value={rename.id === p.id ? rename.value : ''}
                      onChange={(e) => setRename({ id: p.id, value: e.target.value })}
                      sx={{ flex: 1, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
                    />
                    <Button
                      size="small"
                      disabled={rename.id !== p.id || !rename.value.trim()}
                      onClick={() =>
                        act(() => roadSettingApi.renameLine(p.id, rename.value.trim())).then(() =>
                          setRename({ id: null, value: '' })
                        )
                      }
                    >
                      命名
                    </Button>
                  </Stack>
                )}
              </Box>
            );
          })}

          {!rows.length && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              這個範圍沒有資料。
            </Typography>
          )}
        </Stack>

        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary">
          「納入巡查」與「歸誰管」是兩件事：歸市府管但正在施工的路段，管轄仍是市府，但這個月不巡。
          排除的線段不計入覆蓋率的分母。
        </Typography>
      </Paper>
    </Stack>
  );
}
