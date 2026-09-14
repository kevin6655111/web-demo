import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Divider, IconButton, Paper, Slider, Stack, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import QueryForm from '../../components/query/QueryForm';
import { fleetApi, patrolPlanApi } from '../../../models/api/patrolApi';
import { CasePresenter } from '../../../presenters/CasePresenter';
import { useMapLayers } from '../../../context/MapContext';
import { trackQueryFields } from '../../../config/queryFields';
import { useQueryOptions } from '../../../hooks/useQueryOptions';

/**
 * 軌跡查詢。
 *
 * 回放不是花俏 —— 履約爭議時要能回答「這台車幾點在哪裡」，
 * 靜態的一整條線回答不了這個問題。
 *
 * 軌跡與案件是分開的圖層，兩個都開著就能看出
 * 「這趟巡查有沒有經過那幾個坑洞」。
 */
export default function QVehicleTrack() {
  const { registerLayer, removeLayer } = useMapLayers();
  const queryOptions = useQueryOptions();
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({
    DATE_START: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    DATE_END: new Date().toISOString().slice(0, 10)
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const timerRef = useRef(null);

  /**
   * 車輛清單依標案／工務段／轄區收斂。
   *
   * 這幾個條件的意義是「要看哪個範圍的車」，而不是篩軌跡點 ——
   * 軌跡查詢本來就是單車輛的。過去它們被原樣送進軌跡端點，
   * 使用者設了之後只會拿到 400。
   */
  const scope = useMemo(
    () => ({
      PRJ_ID: form.PRJ_ID,
      SECTION_ID: form.SECTION_ID,
      COUNTY: form.COUNTY,
      DISTRICT: Array.isArray(form.DISTRICT) ? form.DISTRICT[0] : form.DISTRICT
    }),
    [form.PRJ_ID, form.SECTION_ID, form.COUNTY, form.DISTRICT]
  );

  useEffect(() => {
    const params = Object.fromEntries(
      Object.entries(scope)
        .filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])
    );

    fleetApi
      .vehicles(params)
      .then((res) => {
        const list = res.data ?? [];
        setVehicles(list);

        // 選中的車若不在收斂後的清單裡，改選第一台 —— 否則畫面顯示著
        // 一台不屬於這個範圍的車，而查詢結果看起來像是壞掉
        setForm((f) => {
          const stillThere = list.some((v) => String(v.ID) === String(f.VEHICLE_ID));
          if (stillThere) return f;
          return { ...f, VEHICLE_ID: list.length ? String(list[0].ID) : '' };
        });
      })
      .catch((err) => setError(err.message));
  }, [scope]);

  useEffect(() => {
    // 巡查計畫路線也登錄成圖層：要看「該巡的有沒有巡到」需要兩者疊看
    patrolPlanApi
      .layer({ ACTIVE: true })
      .then((res) => {
        const features = res.data?.features ?? [];
        registerLayer('plan', {
          group: 'road',
          type: 'line',
          label: '巡查計畫路線',
          color: '#a78bfa',
          dashed: true,
          count: features.length,
          data: features,
          order: 10,
          defaultVisible: false,
          bounds: () => features.flatMap((f) => f.geometry.coordinates.map(([lng, lat]) => [lat, lng]))
        });
      })
      .catch(() => {});
  }, [registerLayer]);

  const search = useCallback(async () => {
    // 車輛清單是非同步載入的，使用者可能在它回來之前就按了查詢。
    // 靜靜 return 是最糟的處理：畫面沒有任何變化，使用者只會再按一次
    if (!form.VEHICLE_ID) {
      setNotice('請先選擇車輛');
      return;
    }

    setNotice('');

    try {
      const res = await fleetApi.track({
        VEHICLE_ID: form.VEHICLE_ID,
        DATE_START: `${form.DATE_START}T00:00:00+08:00`,
        DATE_END: `${form.DATE_END}T23:59:59+08:00`,
        MAX_HDOP: form.MAX_HDOP || undefined
      });
      setData(res.data);
      setCursor(res.data?.POINTS?.length ?? 0);
      setPlaying(false);
    } catch (err) {
      setError(err.message);
    }
  }, [form]);

  // 回放：每 60ms 前進一段，走到底就停
  useEffect(() => {
    if (!playing || !data?.POINTS?.length) return undefined;

    timerRef.current = setInterval(() => {
      setCursor((c) => {
        if (c >= data.POINTS.length) {
          setPlaying(false);
          return c;
        }
        return c + Math.max(1, Math.round(data.POINTS.length / 300));
      });
    }, 60);

    return () => clearInterval(timerRef.current);
  }, [playing, data]);

  // 登錄軌跡圖層；回放時只畫到游標處
  useEffect(() => {
    const points = data?.POINTS ?? [];
    if (!points.length) return;

    const shown = points.slice(0, cursor || points.length);
    const plate = vehicles.find((v) => String(v.ID) === String(form.VEHICLE_ID))?.PLATE_NO ?? '軌跡';

    registerLayer('track', {
      group: 'track',
      type: 'track',
      label: `軌跡 ${plate}`,
      color: '#38bdf8',
      count: shown.length,
      data: shown,
      head: shown[shown.length - 1],
      order: 20,
      bounds: () => shown.map((p) => [p.lat, p.lng])
    });
  }, [data, cursor, registerLayer, vehicles, form.VEHICLE_ID]);

  const points = data?.POINTS ?? [];
  const head = points[Math.max(0, (cursor || points.length) - 1)];

  // 與破壞查詢同一組空間條件：兩個圖層疊看時，
  // 條件不一致會讓「這趟巡查有沒有經過那幾個坑」變成沒辦法回答的問題
  const fields = useMemo(
    () => [
      {
        key: 'VEHICLE_ID',
        label: '車輛',
        type: 'select',
        width: 150,
        options: vehicles.map((v) => ({ value: String(v.ID), label: `${v.PLATE_NO} ${v.NAME ?? ''}` }))
      },
      { key: 'DATE_START', label: '起始日', type: 'date' },
      { key: 'DATE_END', label: '結束日', type: 'date' },
      ...trackQueryFields(queryOptions).filter((f) => !['START_DATE', 'END_DATE', 'CAR'].includes(f.key)),
      { key: 'MAX_HDOP', label: 'GPS 品質上限', placeholder: '5', advanced: true, width: 130 }
    ],
    [vehicles, queryOptions]
  );

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      {notice && (
        <Alert severity="warning" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <QueryForm
        fields={fields}
        value={form}
        onChange={setForm}
        onSearch={search}
        onReset={() => {
          // 「清除」在其他面板都是把條件清空；這裡只清結果不清條件的話，
          // 使用者會以為條件還在生效而其實已經沒有了
          setForm({});
          setData(null);
          setNotice('');
          removeLayer('track');
        }}
        dense
      />

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          行程摘要
        </Typography>

        {data ? (
          <Stack spacing={0.8}>
            {[
              ['里程', `${data.DISTANCE_KM} km`],
              ['最高時速', `${data.MAX_SPEED} km/h`],
              ['平均時速', `${data.AVG_SPEED} km/h`],
              ['原始點數', data.TOTAL_POINTS],
              ['顯示點數', `${data.SAMPLED}（每 ${data.SAMPLE_STEP} 點取 1）`],
              ['起訖', `${CasePresenter.time(data.START_AT)} – ${CasePresenter.time(data.END_AT)}`]
            ].map(([k, v]) => (
              <Stack key={k} direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  {k}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>
                  {v}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            選擇車輛與日期後查詢
          </Typography>
        )}

        {points.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              回放
            </Typography>

            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton size="small" onClick={() => setPlaying((p) => !p)} color="primary">
                {playing ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
              <IconButton
                size="small"
                onClick={() => {
                  setCursor(0);
                  setPlaying(true);
                }}
              >
                <ReplayIcon />
              </IconButton>
              <Slider
                size="small"
                value={cursor}
                min={0}
                max={points.length}
                onChange={(_, v) => {
                  setPlaying(false);
                  setCursor(v);
                }}
              />
            </Stack>

            {head && (
              <Typography variant="caption" color="text.secondary">
                {CasePresenter.time(head.recordedAt)} · {head.speedKph} km/h
              </Typography>
            )}
          </>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary">
          軌跡依速度上色：紅 &lt;10、黃 &lt;30、綠 ≥30 km/h。 在圖層控制打開「破壞案件」就能看出這趟巡查經過了哪些案件。
        </Typography>
      </Paper>
    </Stack>
  );
}
