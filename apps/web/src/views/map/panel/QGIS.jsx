import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import { patrolPlanApi, roadEvalApi, surveyApi, tilesApi } from '../../../models/api/patrolApi';
import { useMapLayers } from '../../../context/MapContext';

/**
 * 圖資查詢：一次把所有圖層載進來。
 *
 * 存在的理由是「關聯」—— 單看案件看不出它落在哪條計畫路線上，
 * 單看路段看不出案件為什麼集中在那裡。
 * 這一頁不做查詢，只負責把所有圖層備齊，過濾交給圖層控制。
 */
export default function QGIS() {
  const { registerLayer, layers } = useMapLayers();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cases, segments, plans, surveys] = await Promise.all([
        tilesApi.caseLayer({}),
        roadEvalApi.layer({}),
        patrolPlanApi.layer({ ACTIVE: true }).catch(() => ({ data: { features: [] } })),
        surveyApi.cases({}).catch(() => ({ data: [] }))
      ]);

      const caseFeatures = cases.data?.features ?? [];
      const segmentFeatures = segments.data?.features ?? [];
      const planFeatures = plans.data?.features ?? [];
      const surveyPoints = (surveys.data ?? []).filter((s) => s.LNG && s.LAT);

      registerLayer('case', {
        group: 'case',
        type: 'case',
        label: '破壞案件',
        color: '#38bdf8',
        count: caseFeatures.length,
        data: caseFeatures,
        order: 30,
        mode: 'cluster',
        modes: [
          { value: 'point', label: '案件' },
          { value: 'cluster', label: '聚合' },
          { value: 'heat', label: '熱點' }
        ],
        bounds: () => caseFeatures.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]])
      });

      registerLayer('segment', {
        group: 'road',
        type: 'line',
        label: '路段評估',
        color: '#fbbf24',
        count: segmentFeatures.length,
        data: segmentFeatures,
        order: 10,
        bounds: () => segmentFeatures.flatMap((f) => f.geometry.coordinates.map(([lng, lat]) => [lat, lng]))
      });

      registerLayer('plan', {
        group: 'road',
        type: 'line',
        label: '巡查計畫路線',
        color: '#a78bfa',
        dashed: true,
        count: planFeatures.length,
        data: planFeatures,
        order: 11,
        defaultVisible: false,
        bounds: () => planFeatures.flatMap((f) => f.geometry.coordinates.map(([lng, lat]) => [lat, lng]))
      });

      registerLayer('survey', {
        group: 'survey',
        type: 'point',
        label: '鋪面調查點',
        color: '#f472b6',
        count: surveyPoints.length,
        data: surveyPoints,
        order: 31,
        defaultVisible: false,
        bounds: () => surveyPoints.map((p) => [p.LAT, p.LNG])
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [registerLayer]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <LayersIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          圖資總覽
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        所有圖層都已載入，用下方的圖層控制決定要看哪些、疊多深。
      </Typography>

      <Divider sx={{ my: 1.5 }} />

      <Stack spacing={0.8}>
        {layers.map((l) => (
          <Stack key={l.key} direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: l.color }} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {l.label}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
              {l.count ?? 0}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Button size="small" fullWidth variant="outlined" onClick={loadAll} disabled={loading} sx={{ mt: 2 }}>
        {loading ? '載入中…' : '重新載入圖資'}
      </Button>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        疊圖能回答單一圖層答不了的問題：
        案件是否集中在低分路段、巡查路線有沒有涵蓋到那些案件、調查點選得對不對。
      </Typography>
    </Paper>
  );
}
