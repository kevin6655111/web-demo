import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import QueryForm from '../../components/query/QueryForm';
import { roadEvalApi } from '../../../models/api/patrolApi';
import { MAINTAIN_COLOR, MAINTAIN_LABEL } from '../../../config/vocabulary';
import { useUser } from '../../../context/UserContext';
import { useMapLayers } from '../../../context/MapContext';
import { roadEvalQueryFields } from '../../../config/queryFields';
import { useQueryOptions } from '../../../hooks/useQueryOptions';

const OWN_FIELDS = [
  {
    key: 'MAINTAIN_LEVEL',
    label: '養護等級',
    type: 'multi',
    options: Object.entries(MAINTAIN_LABEL).map(([value, label]) => ({ value, label }))
  },
  { key: 'PCI_MIN', label: 'PCI 下限', type: 'number', advanced: true, width: 110 },
  { key: 'PCI_MAX', label: 'PCI 上限', type: 'number', advanced: true, width: 110 }
];

/**
 * 道路評估。
 *
 * 用線而不是點：決策的單位是路段 —— 不會為了一個坑洞刨鋪整條路，
 * 但一條路上密集出現坑洞就該整段處理。
 * 把破壞案件圖層一起打開，就看得出分數是怎麼來的。
 */
export default function QRoadEval() {
  const { can } = useUser();
  const { registerLayer } = useMapLayers();
  const queryOptions = useQueryOptions();
  const [form, setForm] = useState({});
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (query = {}) => {
      try {
        const params = Object.fromEntries(
          Object.entries(query).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))
        );
        if (Array.isArray(params.MAINTAIN_LEVEL)) params.MAINTAIN_LEVEL = params.MAINTAIN_LEVEL.join(',');

        const [layer, sum] = await Promise.all([roadEvalApi.layer(params), roadEvalApi.summary()]);
        const features = layer.data?.features ?? [];
        setSummary(sum.data);

        registerLayer('segment', {
          group: 'road',
          type: 'line',
          label: '路段評估',
          color: 'var(--c-warning)',
          count: features.length,
          data: features,
          order: 10, // 線畫在點之下
          bounds: () => features.flatMap((f) => f.geometry.coordinates.map(([lng, lat]) => [lat, lng]))
        });
      } catch (err) {
        setError(err.message);
      }
    },
    [registerLayer]
  );

  useEffect(() => {
    load();
  }, [load]);

  const reevaluate = async () => {
    setBusy(true);
    try {
      await roadEvalApi.evaluate();
      await load(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // 空間條件與其他圖台面板同一份；路段代碼與養護等級是這個面板專屬的
  const fields = useMemo(() => [...roadEvalQueryFields(queryOptions), ...OWN_FIELDS], [queryOptions]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
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

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          養護等級分布
        </Typography>

        {summary && (
          <>
            <Stack spacing={1.2}>
              {summary.BY_LEVEL.map((b) => {
                const ratio = summary.TOTAL ? (b.COUNT / summary.TOTAL) * 100 : 0;

                return (
                  <Box key={b.LEVEL}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.4 }}>
                      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: MAINTAIN_COLOR[b.LEVEL] }} />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {MAINTAIN_LABEL[b.LEVEL]}
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        {b.COUNT} 段 / {b.LENGTH_KM} km
                      </Typography>
                    </Stack>
                    <Box sx={{ height: 5, borderRadius: 3, bgcolor: 'action.selected' }}>
                      <Box
                        sx={{
                          width: `${ratio}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: MAINTAIN_COLOR[b.LEVEL]
                        }}
                      />
                    </Box>
                  </Box>
                );
              })}
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">
                需維修比例
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: summary.NEED_REPAIR_RATE > 30 ? 'error.main' : 'text.primary', fontWeight: 600 }}
              >
                {summary.NEED_REPAIR} / {summary.TOTAL}（{summary.NEED_REPAIR_RATE}%）
              </Typography>
            </Stack>
          </>
        )}

        {can('ROAD_EVAL.UPDATE') && (
          <Button
            size="small"
            variant="outlined"
            fullWidth
            startIcon={<RefreshIcon />}
            onClick={reevaluate}
            disabled={busy}
            sx={{ mt: 1.5 }}
          >
            {busy ? '重算中…' : '依案件密度重算'}
          </Button>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          PCI 由案件密度推算；鋪面調查的實測分數會覆蓋這個推算值。 把「破壞案件」圖層一起打開，就看得出分數是怎麼來的。
        </Typography>
      </Paper>
    </Stack>
  );
}
