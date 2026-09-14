import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import QueryForm from '../../components/query/QueryForm';
import PatrolPointDialog from '../../components/dialog/PatrolPointDialog';
import { roadSettingApi } from '../../../models/api/patrolApi';
import { RoadSettingPresenter } from '../../../presenters/RoadSettingPresenter';
import { useMapLayers } from '../../../context/MapContext';
import { useQueryOptions } from '../../../hooks/useQueryOptions';
import { useUser } from '../../../context/UserContext';

/**
 * 巡查點與點位覆蓋率。
 *
 * 契約常寫「這些路口每週至少要看一次」—— 那是點而不是線，
 * 用路線覆蓋率算不出來：一條路線的 90% 覆蓋率，
 * 可能正好漏掉了業主最在意的那個路口。
 *
 * 覆蓋率讀的是每日統計表而不是即時算：那個計算要掃整天的軌跡點，
 * 一次幾秒鐘，而它是每次開啟這個面板都要的數字。
 */
export default function QPatrolPoint() {
  const { can } = useUser();
  const { registerLayer } = useMapLayers();
  const queryOptions = useQueryOptions();

  const [form, setForm] = useState({});
  const [points, setPoints] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [range, setRange] = useState({
    DATE_START: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
    DATE_END: new Date().toISOString().slice(0, 10)
  });
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (query, dates) => {
      try {
        const params = { ...query };
        for (const [k, v] of Object.entries(params)) if (Array.isArray(v)) params[k] = v.join(',');

        const [pointRes, covRes] = await Promise.all([
          roadSettingApi.points(params),
          roadSettingApi.pointCoverage(dates).catch(() => ({ data: null }))
        ]);

        const features = pointRes.data?.features ?? [];
        setPoints(features);
        setCoverage(covRes.data);

        registerLayer('patrolPoint', {
          group: 'road',
          type: 'geojson-point',
          label: '巡查點',
          color: 'var(--c-info)',
          count: features.length,
          data: features,
          order: 35,
          bounds: () => features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]])
        });
      } catch (err) {
        setError(err.message);
      }
    },
    [registerLayer]
  );

  useEffect(() => {
    load(form, range);
    // 掛載時載入一次；之後由查詢按鈕觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields = useMemo(
    () => [
      { key: 'ROAD_NAME', label: '路名', width: 140 },
      {
        key: 'DISTRICT',
        label: '行政區',
        type: 'multi',
        options: (queryOptions.districts ?? []).map((d) => ({ value: d.DISTRICT, label: d.DISTRICT }))
      },
      {
        key: 'IS_ACTIVE',
        label: '狀態',
        type: 'select',
        options: [
          { value: 'true', label: '啟用' },
          { value: 'false', label: '停用' }
        ]
      }
    ],
    [queryOptions]
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={() => load(form, range)}
        onReset={() => {
          setForm({});
          load({}, range);
        }}
        dense
      />

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            點位覆蓋率
          </Typography>
          {can('ROAD_SETTING.UPDATE') && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setDialog({ row: null })}>
              新增巡查點
            </Button>
          )}
        </Stack>

        <QueryForm
          fields={[
            { key: 'DATE_START', label: '起', type: 'date' },
            { key: 'DATE_END', label: '迄', type: 'date' }
          ]}
          value={range}
          onChange={setRange}
          onSearch={() => load(form, range)}
          onReset={() => load(form, range)}
          dense
        />

        {coverage ? (
          <>
            <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  覆蓋率
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: RoadSettingPresenter.coverageColor(coverage.COVERAGE)
                  }}
                >
                  {coverage.COVERAGE}%
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  已巡 / 應巡
                </Typography>
                <Typography variant="h5" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {coverage.COVERED} / {coverage.REQUIRED}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  未出車天數
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: coverage.NO_TRACK_DAYS ? 'error.main' : 'inherit'
                  }}
                >
                  {coverage.NO_TRACK_DAYS}
                </Typography>
              </Box>
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              覆蓋率 0 時要分得出「沒出車」與「出車但沒到點」—— 前者是調度問題，後者是路線規劃問題。
            </Typography>

            <Divider sx={{ my: 1.5 }} />

            <Stack spacing={0.6} sx={{ maxHeight: 200, overflowY: 'auto' }}>
              {(coverage.ROWS ?? []).map((r, i) => (
                <Stack key={i} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="caption" sx={{ width: 82, fontFamily: '"JetBrains Mono", monospace' }}>
                    {String(r.DATE).slice(5, 10)}
                  </Typography>
                  <Typography variant="caption" sx={{ width: 60 }}>
                    {r.DISTRICT}
                  </Typography>
                  <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.selected' }}>
                    <Box
                      sx={{
                        width: `${r.COVERAGE}%`,
                        height: '100%',
                        borderRadius: 3,
                        bgcolor: RoadSettingPresenter.coverageColor(r.COVERAGE)
                      }}
                    />
                  </Box>
                  <Typography variant="caption" sx={{ width: 78, textAlign: 'right' }}>
                    {r.COVERED}/{r.REQUIRED}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : (
          <Alert severity="info" sx={{ mt: 1.5, fontSize: 13 }}>
            這個範圍還沒有覆蓋率統計。統計由「巡查點覆蓋率統計」排程每小時產生，也可以在系統管理裡手動觸發。
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          巡查點 {points.length}
        </Typography>

        <Stack spacing={0.6} sx={{ maxHeight: 260, overflowY: 'auto' }}>
          {points.map((f) => (
            <Box
              key={f.properties.id}
              onClick={() => can('ROAD_SETTING.UPDATE') && setDialog({ row: { ...f.properties, geometry: f.geometry } })}
              sx={{
                p: 1,
                borderRadius: 1.5,
                border: (t) => `1px solid ${t.palette.divider}`,
                cursor: can('ROAD_SETTING.UPDATE') ? 'pointer' : 'default'
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.8}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {f.properties.name}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {f.properties.code}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.3 }}>
                <Chip size="small" label={f.properties.district ?? '未分區'} sx={{ height: 18, fontSize: 10 }} />
                <Chip size="small" label={`半徑 ${f.properties.radiusM} m`} sx={{ height: 18, fontSize: 10 }} />
                {!f.properties.isActive && (
                  <Chip size="small" color="default" variant="outlined" label="停用" sx={{ height: 18, fontSize: 10 }} />
                )}
              </Stack>
            </Box>
          ))}

          {!points.length && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              這個範圍沒有巡查點。
            </Typography>
          )}
        </Stack>
      </Paper>

      <PatrolPointDialog
        open={!!dialog}
        row={dialog?.row}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          load(form, range);
        }}
      />
    </Stack>
  );
}
