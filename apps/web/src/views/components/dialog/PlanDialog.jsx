import { useEffect, useState } from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { fleetApi, patrolPlanApi, projectApi } from '../../../models/api/patrolApi';

const FREQ = { DAILY: '每日', WEEKLY: '每週', BIWEEKLY: '雙週', MONTHLY: '每月' };

/**
 * 巡查計畫。
 *
 * 路線用座標序列輸入（正式系統是在地圖上畫）。
 * 緩衝距離決定「走多近算巡過」—— 30 公尺讓對向車道也算，
 * 太小的話單向道路永遠達不到覆蓋率，太大則巷弄會互相覆蓋。
 */
export default function PlanDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!open) return;

    setForm({
      CODE: row?.CODE ?? '',
      NAME: row?.NAME ?? '',
      FREQUENCY: row?.FREQUENCY ?? 'WEEKLY',
      VEHICLE_ID: row?.VEHICLE_ID ? String(row.VEHICLE_ID) : '',
      PROJECT_ID: row?.PROJECT_ID ? String(row.PROJECT_ID) : '',
      BUFFER_M: row?.BUFFER_M ?? 30,
      ACTIVE: row?.ACTIVE ?? true,
      ROUTE: ''
    });
    setErrors({});
    setError('');

    fleetApi
      .vehicles({})
      .then((res) => setVehicles(res.data ?? []))
      .catch(() => {});
    projectApi
      .list()
      .then((res) => setProjects(res.data ?? []))
      .catch(() => {});
  }, [open, row]);

  const fields = [
    { key: 'CODE', label: '計畫代號', required: true, placeholder: 'PLAN-004' },
    { key: 'NAME', label: '計畫名稱', required: true },
    {
      key: 'FREQUENCY',
      label: '頻率',
      type: 'select',
      required: true,
      options: Object.entries(FREQ).map(([value, label]) => ({ value, label }))
    },
    {
      key: 'VEHICLE_ID',
      label: '指派車輛',
      type: 'select',
      options: vehicles.map((v) => ({ value: String(v.ID), label: v.PLATE_NO }))
    },
    {
      key: 'PROJECT_ID',
      label: '所屬標案',
      type: 'select',
      options: projects.map((p) => ({ value: String(p.ID), label: p.CODE }))
    },
    { key: 'BUFFER_M', label: '覆蓋緩衝距離', type: 'number', unit: 'm', hint: '走多近算巡過；30 公尺讓對向車道也算' },
    { key: 'ACTIVE', label: '啟用（納入覆蓋率計算）', type: 'switch', full: true },
    {
      key: 'ROUTE',
      label: '路線座標',
      type: 'textarea',
      rows: 4,
      hint: '每行一組「經度,緯度」，至少兩點。正式系統是在地圖上直接畫',
      placeholder: '120.6400,24.1600\n120.6600,24.1700\n120.6800,24.1750'
    }
  ];

  const parseRoute = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(',').map((n) => Number(n.trim())))
      .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));

  const submit = async () => {
    const route = parseRoute(form.ROUTE ?? '');

    const next = {};
    if (!form.CODE?.trim()) next.CODE = '必填';
    if (!form.NAME?.trim()) next.NAME = '必填';
    if (route.length < 2) next.ROUTE = '至少要兩個座標點';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await patrolPlanApi.upsert({
        ID: row?.ID,
        CODE: form.CODE,
        NAME: form.NAME,
        FREQUENCY: form.FREQUENCY,
        ROUTE: route,
        VEHICLE_ID: form.VEHICLE_ID ? Number(form.VEHICLE_ID) : undefined,
        PROJECT_ID: form.PROJECT_ID ? Number(form.PROJECT_ID) : undefined,
        BUFFER_M: Number(form.BUFFER_M) || 30,
        ACTIVE: !!form.ACTIVE
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title={row ? '編輯巡查計畫' : '新增巡查計畫'}
      subtitle="契約通常寫「每條路每週至少巡一次」，覆蓋率就是依此計算"
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
        <Typography variant="caption" color="text.secondary">
          路線長度由資料庫計算，不採用前端傳來的數字 —— 不同投影下的公里數會差好幾個百分點，而這個數字會進計費。
        </Typography>
      </Stack>
    </FormDialog>
  );
}
