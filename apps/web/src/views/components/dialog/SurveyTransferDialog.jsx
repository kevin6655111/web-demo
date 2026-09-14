import { useEffect, useState } from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { surveyApi } from '../../../models/api/patrolApi';

/**
 * 轉讓調查點到另一張委託單。
 *
 * 理由必填並寫進歷程：驗收時一定會被問「這個點原本屬於誰」，
 * 而搬過去之後從資料上看不出來 —— 只有歷程說得出口。
 */
export default function SurveyTransferDialog({ open, ids = [], orders = [], onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [details, setDetails] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ TO_ORDER_ID: '', TO_DETAIL_ID: '', REASON: '' });
    setDetails([]);
    setErrors({});
    setError('');
  }, [open]);

  // 選了目標委託單才去載它的明細：一開始就全部載進來是沒有必要的請求
  useEffect(() => {
    if (!form.TO_ORDER_ID) {
      setDetails([]);
      return;
    }

    surveyApi
      .details(form.TO_ORDER_ID)
      .then((res) => setDetails(res.data ?? []))
      .catch(() => setDetails([]));
  }, [form.TO_ORDER_ID]);

  const submit = async () => {
    const next = {};
    if (!form.TO_ORDER_ID) next.TO_ORDER_ID = '必填';
    if (!form.REASON?.trim()) next.REASON = '必填';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await surveyApi.transfer(
        ids,
        Number(form.TO_ORDER_ID),
        form.REASON,
        form.TO_DETAIL_ID ? Number(form.TO_DETAIL_ID) : undefined
      );
      onSaved?.(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="轉讓調查點"
      subtitle={`已選 ${ids.length} 筆`}
      submitLabel="轉讓"
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="warning" sx={{ fontSize: 13 }}>
          轉讓是**搬移**而不是重建：現場照片與量測值會跟著走。已結案的委託單不可轉入。
        </Alert>

        <FormFields
          fields={[
            {
              key: 'TO_ORDER_ID',
              label: '目標委託單',
              type: 'select',
              required: true,
              full: true,
              options: orders
                .filter((o) => o.STATE !== 'CLOSED')
                .map((o) => ({ value: String(o.ID), label: `${o.ORDER_NO} ${o.TITLE}` }))
            },
            {
              key: 'TO_DETAIL_ID',
              label: '目標明細',
              type: 'select',
              full: true,
              hint: '省略時不掛明細，成為臨時加測點',
              options: details.map((d) => ({ value: String(d.ID), label: `第 ${d.SEQ} 項 ${d.ROAD}` }))
            },
            {
              key: 'REASON',
              label: '轉讓理由',
              type: 'textarea',
              rows: 2,
              required: true,
              full: true,
              hint: '會寫進歷程 —— 驗收時要說得出這個點原本屬於誰'
            }
          ]}
          value={form}
          errors={errors}
          onChange={setForm}
        />

        <Typography variant="caption" color="text.secondary">
          轉讓後這些調查點會計入目標委託單的進度，原委託單的進度會跟著下降。
        </Typography>
      </Stack>
    </FormDialog>
  );
}
