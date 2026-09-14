import { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { surveyApi } from '../../../models/api/patrolApi';

/**
 * 委託明細：業主指定的一段路。
 *
 * 樁號拆成公里與公尺兩個欄位而不是一個字串 —— 報表要依樁號排序，
 * 而 `3K+250` 這種字串排序會把 `10K+000` 排在 `3K+250` 前面。
 */
export default function SurveyDetailDialog({ open, orderId, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    setForm({
      ROAD: row?.ROAD ?? '',
      ROAD_START: row?.ROAD_START ?? '',
      ROAD_END: row?.ROAD_END ?? '',
      STATION_K: row?.STATION_K ?? '',
      STATION_M: row?.STATION_M ?? '',
      DIRECTION: row?.DIRECTION ?? 'BOTH',
      LANE_COUNT: row?.LANE_COUNT ?? 2,
      SAMPLE_COUNT: row?.SAMPLE_COUNT ?? 1,
      ROAD_LENGTH_M: row?.ROAD_LENGTH_M ?? '',
      ROAD_WIDTH_M: row?.ROAD_WIDTH_M ?? '',
      REMARK: row?.REMARK ?? ''
    });
    setErrors({});
    setError('');
  }, [open, row]);

  const fields = [
    { key: 'ROAD', label: '路段名稱', required: true, full: true, placeholder: '中山路一段' },
    { key: 'ROAD_START', label: '起點', placeholder: '文心路口' },
    { key: 'ROAD_END', label: '迄點', placeholder: '大墩路口' },
    { key: 'STATION_K', label: '樁號(公里)', type: 'number', hint: '3K+250 的 3' },
    { key: 'STATION_M', label: '樁號(公尺)', type: 'number', hint: '3K+250 的 250' },
    {
      key: 'DIRECTION',
      label: '調查方向',
      type: 'select',
      options: [
        { value: 'BOTH', label: '雙向' },
        { value: 'FORWARD', label: '順向' },
        { value: 'BACKWARD', label: '逆向' }
      ]
    },
    { key: 'LANE_COUNT', label: '車道數', type: 'number' },
    { key: 'SAMPLE_COUNT', label: '應取樣數', type: 'number', required: true, hint: '進度的分母' },
    { key: 'ROAD_LENGTH_M', label: '路段長度', type: 'number', unit: 'm' },
    { key: 'ROAD_WIDTH_M', label: '路寬', type: 'number', unit: 'm' },
    { key: 'REMARK', label: '備註', type: 'textarea', rows: 2, full: true }
  ];

  const submit = async () => {
    if (!form.ROAD?.trim()) {
      setErrors({ ROAD: '必填' });
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

      await surveyApi.upsertDetail({
        ID: row?.ID,
        ORDER_ID: orderId,
        ROAD: form.ROAD,
        ROAD_START: form.ROAD_START || undefined,
        ROAD_END: form.ROAD_END || undefined,
        STATION_K: num(form.STATION_K),
        STATION_M: num(form.STATION_M),
        DIRECTION: form.DIRECTION,
        LANE_COUNT: num(form.LANE_COUNT),
        SAMPLE_COUNT: num(form.SAMPLE_COUNT),
        ROAD_LENGTH_M: num(form.ROAD_LENGTH_M),
        ROAD_WIDTH_M: num(form.ROAD_WIDTH_M),
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
      title={row ? `編輯明細 第 ${row.SEQ} 項` : '新增委託明細'}
      subtitle={row ? row.ROAD : '序號會接在最後 —— 業主給的清單是有順序的'}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="info" sx={{ fontSize: 13 }}>
          「應取樣數」是進度的分母。填 3 表示這一段路要取三個樣，完成兩個就是 67%。
        </Alert>

        <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
      </Stack>
    </FormDialog>
  );
}
