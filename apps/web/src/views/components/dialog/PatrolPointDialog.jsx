import { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { roadSettingApi } from '../../../models/api/patrolApi';

/**
 * 巡查點。
 *
 * `radiusM` 是判定半徑：軌跡點落在這個範圍內就算巡到。
 * 每個點各自設定，因為大路口與小巷口的合理範圍不同 ——
 * 全部用同一個半徑的話，路口會過度寬鬆而巷口會永遠算不到。
 */
export default function PatrolPointDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    const [lng, lat] = row?.geometry?.coordinates ?? [];

    setForm({
      CODE: row?.code ?? '',
      NAME: row?.name ?? '',
      LNG: lng ?? '',
      LAT: lat ?? '',
      COUNTY: row?.county ?? '示範市',
      DISTRICT: row?.district ?? '',
      ROAD_NAME: row?.roadName ?? '',
      RADIUS_M: row?.radiusM ?? 30,
      IS_ACTIVE: row?.isActive ?? true,
      REMARK: row?.remark ?? ''
    });
    setErrors({});
    setError('');
  }, [open, row]);

  const submit = async () => {
    const next = {};
    if (!form.CODE?.trim()) next.CODE = '必填';
    if (!form.NAME?.trim()) next.NAME = '必填';
    if (!Number.isFinite(Number(form.LNG))) next.LNG = '必填';
    if (!Number.isFinite(Number(form.LAT))) next.LAT = '必填';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await roadSettingApi.upsertPoint({
        ID: row?.id,
        CODE: form.CODE,
        NAME: form.NAME,
        LNG: Number(form.LNG),
        LAT: Number(form.LAT),
        COUNTY: form.COUNTY || undefined,
        DISTRICT: form.DISTRICT || undefined,
        ROAD_NAME: form.ROAD_NAME || undefined,
        RADIUS_M: Number(form.RADIUS_M) || 30,
        IS_ACTIVE: !!form.IS_ACTIVE,
        REMARK: form.REMARK || undefined
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
      title={row ? '編輯巡查點' : '新增巡查點'}
      subtitle={row ? row.code : '代號在公司內唯一'}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="info" sx={{ fontSize: 13 }}>
          判定半徑是「車子開到多近算巡到」。大路口用 40–50 公尺、巷口用 20–30 公尺 ——
          統一用同一個值的話，路口會過度寬鬆而巷口永遠算不到。
        </Alert>

        <FormFields
          fields={[
            { key: 'CODE', label: '代號', required: true, placeholder: 'PT-001' },
            { key: 'NAME', label: '名稱', required: true, placeholder: '中山路／文心路口' },
            { key: 'LNG', label: '經度', type: 'number', required: true },
            { key: 'LAT', label: '緯度', type: 'number', required: true },
            { key: 'COUNTY', label: '縣市' },
            { key: 'DISTRICT', label: '行政區' },
            { key: 'ROAD_NAME', label: '路名' },
            { key: 'RADIUS_M', label: '判定半徑', type: 'number', unit: 'm' },
            { key: 'IS_ACTIVE', label: '啟用', type: 'switch' },
            { key: 'REMARK', label: '備註', type: 'textarea', rows: 2, full: true }
          ]}
          value={form}
          errors={errors}
          onChange={setForm}
        />
      </Stack>
    </FormDialog>
  );
}
