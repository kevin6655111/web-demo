import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Divider, Paper, Stack, Typography } from '@mui/material';
import QueryForm from '../../components/query/QueryForm';
import { tilesApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { caseQueryFields } from '../../../config/queryFields';
import { useQueryOptions } from '../../../hooks/useQueryOptions';
import { NEED_REPAIR_LABEL } from '../../../config/vocabulary';
import { useRealtime } from '../../../hooks/useRealtime';
import { useMapLayers } from '../../../context/MapContext';



/** 破壞查詢：查詢條件 + 把案件圖層登錄到共用地圖 */
export default function QVehicleCrack() {
  const { registerLayer, layerMap } = useMapLayers();
  const queryOptions = useQueryOptions({ withCars: true });
  const [form, setForm] = useState({});
  const [applied, setApplied] = useState({});
  const [features, setFeatures] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async (query) => {
    try {
      // 單選的條件下推到圖層 API（快取切得動），多選留在前端過濾 ——
      // 每一種組合都切一份快取，快取就等於沒有
      const res = await tilesApi.caseLayer({
        STATUS: query.STATUS?.length === 1 ? query.STATUS[0] : undefined,
        NEED_REPAIR: query.NEED_REPAIR?.length === 1 ? query.NEED_REPAIR[0] : undefined,
        CRACK_TYPE: query.CRACK_TYPE?.length === 1 ? query.CRACK_TYPE[0] : undefined,
        DEGREE: query.DEGREE?.length === 1 ? query.DEGREE[0] : undefined,
        COUNTY: query.COUNTY || undefined,
        PRJ_ID: query.PRJ_ID?.length === 1 ? query.PRJ_ID[0] : undefined,
        DISTRICT: query.DISTRICT?.length === 1 ? query.DISTRICT[0] : undefined,
        CAR: query.CAR || undefined
      });
      setFeatures(res.data.features ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  useRealtime({
    channels: ['case'],
    onMessage: useCallback((msg) => {
      if (msg.type !== 'case.created') return;

      setFeatures((prev) => [
        ...prev,
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [msg.data.lng, msg.data.lat] },
          properties: {
            id: msg.data.caseId,
            externalId: msg.data.externalId,
            crackType: msg.data.crackType,
            // 剛進來的案件還沒二篩也還沒判定要不要修
            status: 0,
            needRepair: 0,
            isNew: true
          }
        }
      ]);
    }, [])
  });

  // 圖台的常用條件是空間視角：先框範圍(縣市/標案/工務段/行政區/車輛)，
  // 其餘條件收進進階 —— 與案件列表共用同一份定義，兩邊查得到的東西才會一致
  const fields = useMemo(() => caseQueryFields({ ...queryOptions, forMap: true }), [queryOptions]);

  const shown = useMemo(
    () =>
      features.filter((f) => {
        const p = f.properties;
        if (applied.STATUS?.length && !applied.STATUS.includes(p.status)) return false;
        if (applied.NEED_REPAIR?.length && !applied.NEED_REPAIR.includes(p.needRepair)) return false;
        if (applied.CRACK_TYPE?.length && !applied.CRACK_TYPE.includes(p.crackType)) return false;
        if (applied.DEGREE?.length && p.degree && !applied.DEGREE.includes(p.degree)) return false;
        if (applied.SOURCE?.length && p.source && !applied.SOURCE.includes(p.source)) return false;
        if (applied.ROAD && !(p.roadName ?? '').includes(applied.ROAD)) return false;
        if (applied.ADDRESS && !(p.address ?? '').includes(applied.ADDRESS)) return false;
        if (applied.CASE_NUM && !(p.caseNum ?? '').includes(applied.CASE_NUM)) return false;
        if (applied.DISTRICT?.length && p.district && !applied.DISTRICT.includes(p.district)) return false;
        if (applied.CAR && p.car && p.car !== applied.CAR) return false;
        if (applied.AREA_MIN && Number(p.area ?? 0) < Number(applied.AREA_MIN)) return false;
        if (applied.AREA_MAX && Number(p.area ?? 0) > Number(applied.AREA_MAX)) return false;
        return true;
      }),
    [features, applied]
  );

  // 登錄到共用地圖：資料變動時更新，開關與透明度由使用者保留
  useEffect(() => {
    registerLayer('case', {
      group: 'case',
      type: 'case',
      label: '破壞案件',
      color: 'var(--c-info)',
      count: shown.length,
      data: shown,
      order: 30, // 點位畫在線之上，否則會被路段線壓住而點不到
      mode: layerMap.case?.mode ?? 'cluster',
      modes: [
        { value: 'point', label: '案件' },
        { value: 'cluster', label: '聚合' },
        { value: 'heat', label: '熱點' }
      ],
      bounds: () => shown.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]])
    });
  }, [shown, registerLayer, layerMap.case?.mode]);

  const counts = useMemo(() => {
    const acc = {};
    // 統計看修繕狀態：承辦在地圖上找的是「還沒修的在哪」
    for (const f of shown) acc[f.properties.needRepair] = (acc[f.properties.needRepair] ?? 0) + 1;
    return acc;
  }, [shown]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={() => setApplied(form)}
        onReset={() => {
          setForm({});
          setApplied({});
        }}
        dense
      />

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          案件統計
        </Typography>

        <Stack spacing={1}>
          {Object.entries(NEED_REPAIR_LABEL).map(([key, label]) => (
            <Stack key={key} direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: CasePresenter.needRepairColor(key) }} />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {label}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {counts[key] ?? 0}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="caption" color="text.secondary">
          顯示 {shown.length} / 共 {features.length} 筆。
          點多時用圖層控制切「聚合」或「熱點」—— 上千個點疊在一起時，個別點位反而看不出哪一區最嚴重。
        </Typography>
      </Paper>
    </Stack>
  );
}
