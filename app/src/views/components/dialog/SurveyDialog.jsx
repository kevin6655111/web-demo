import { useEffect, useState } from 'react';
import { Alert, Divider, Stack, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { authApi, projectApi, roadEvalApi, surveyApi } from '../../../models/api/patrolApi';
import { SURVEY_METHOD_LABEL, SURVEY_ORDER_STATE_LABEL } from '../../../styles/theme';

/**
 * 鋪面調查委託單與調查點。
 *
 * 委託與派工的差別：派工是「去修」，委託是「去看」。
 * 調查完成且填了 PCI 時，會回寫該路段的評分 ——
 * 實地量測的可信度高於用案件密度推算的分數。
 */
export function SurveyOrderDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!open) return;

    setForm({
      TITLE: row?.TITLE ?? '',
      REQUESTER: row?.REQUESTER ?? '',
      SURVEYOR_ID: row?.SURVEYOR_ID ? String(row.SURVEYOR_ID) : '',
      PROJECT_ID: row?.PROJECT_ID ? String(row.PROJECT_ID) : '',
      DUE_DATE: row?.DUE_DATE ?? '',
      STATE: row?.STATE ?? 'DRAFT',
      REMARK: row?.REMARK ?? ''
    });
    setErrors({});
    setError('');

    authApi.orgUsers().then((res) => setUsers((res.data ?? []).filter((u) => u.ACTIVE))).catch(() => {});
    projectApi.list().then((res) => setProjects(res.data ?? [])).catch(() => {});
  }, [open, row]);

  const fields = [
    { key: 'TITLE', label: '調查標題', required: true, full: true, placeholder: '臺灣大道路面爭議調查' },
    { key: 'REQUESTER', label: '委託單位', placeholder: '示範市政府建設局' },
    { key: 'SURVEYOR_ID', label: '調查人員', type: 'select', options: users.map((u) => ({ value: String(u.ID), label: u.USER_NAME })) },
    { key: 'PROJECT_ID', label: '所屬標案', type: 'select', options: projects.map((p) => ({ value: String(p.ID), label: p.CODE })) },
    { key: 'DUE_DATE', label: '期限', type: 'date' },
    {
      key: 'STATE',
      label: '狀態',
      type: 'select',
      required: true,
      options: Object.entries(SURVEY_ORDER_STATE_LABEL).map(([value, label]) => ({ value, label }))
    },
    { key: 'REMARK', label: '備註', type: 'textarea', rows: 2 }
  ];

  const submit = async () => {
    if (!form.TITLE?.trim()) {
      setErrors({ TITLE: '必填' });
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await surveyApi.upsertOrder({
        ID: row?.ID,
        TITLE: form.TITLE,
        REQUESTER: form.REQUESTER || undefined,
        SURVEYOR_ID: form.SURVEYOR_ID ? Number(form.SURVEYOR_ID) : undefined,
        PROJECT_ID: form.PROJECT_ID ? Number(form.PROJECT_ID) : undefined,
        DUE_DATE: form.DUE_DATE || undefined,
        STATE: form.STATE,
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
      title={row ? '編輯委託單' : '新增調查委託單'}
      subtitle={row ? row.ORDER_NO : '單號由系統依日期自動編碼'}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
    </FormDialog>
  );
}

/** 調查點：一次實地量測 */
export function SurveyCaseDialog({ open, orderId, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [segments, setSegments] = useState([]);

  useEffect(() => {
    if (!open) return;

    setForm({
      LNG: row?.LNG ?? '',
      LAT: row?.LAT ?? '',
      METHOD: row?.METHOD ?? 'VISUAL',
      ROAD_NAME: row?.ROAD_NAME ?? '',
      SEGMENT_ID: row?.SEGMENT_ID ? String(row.SEGMENT_ID) : '',
      THICKNESS_CM: row?.THICKNESS_CM ?? '',
      PCI: row?.PCI ?? '',
      IRI: row?.IRI ?? '',
      STATE: row?.STATE ?? 'PENDING',
      FINDING: row?.FINDING ?? ''
    });
    setErrors({});
    setError('');

    roadEvalApi.segments({}).then((res) => setSegments(res.data ?? [])).catch(() => {});
  }, [open, row]);

  const fields = [
    { key: 'LNG', label: '經度', type: 'number', required: true },
    { key: 'LAT', label: '緯度', type: 'number', required: true },
    {
      key: 'METHOD',
      label: '調查方法',
      type: 'select',
      required: true,
      options: Object.entries(SURVEY_METHOD_LABEL).map(([value, label]) => ({ value, label })),
      hint: '不同方法可信度不同，報告會標示'
    },
    { key: 'ROAD_NAME', label: '路名' },
    {
      key: 'SEGMENT_ID',
      label: '對應路段',
      type: 'select',
      full: true,
      options: segments.map((s) => ({ value: String(s.ID), label: `${s.CODE} ${s.ROAD_NAME}${s.SECTION ?? ''}（PCI ${s.PCI}）` })),
      hint: '調查完成且填了 PCI 時，會回寫這個路段的評分'
    },
    { key: 'THICKNESS_CM', label: '鋪面厚度', type: 'number', unit: 'cm' },
    { key: 'PCI', label: '實測 PCI', type: 'number', hint: '0–100，越高越好' },
    { key: 'IRI', label: '國際糙度 IRI', type: 'number', unit: 'm/km' },
    {
      key: 'STATE',
      label: '狀態',
      type: 'select',
      options: [
        { value: 'PENDING', label: '待調查' },
        { value: 'DONE', label: '已完成' },
        { value: 'REJECTED', label: '不予採計' }
      ]
    },
    { key: 'FINDING', label: '調查發現', type: 'textarea', rows: 2 }
  ];

  const submit = async () => {
    const next = {};
    if (!Number.isFinite(Number(form.LNG))) next.LNG = '必填';
    if (!Number.isFinite(Number(form.LAT))) next.LAT = '必填';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await surveyApi.upsertCase({
        ID: row?.ID,
        ORDER_ID: orderId,
        LNG: Number(form.LNG),
        LAT: Number(form.LAT),
        METHOD: form.METHOD,
        ROAD_NAME: form.ROAD_NAME || undefined,
        SEGMENT_ID: form.SEGMENT_ID ? Number(form.SEGMENT_ID) : undefined,
        THICKNESS_CM: form.THICKNESS_CM !== '' ? Number(form.THICKNESS_CM) : undefined,
        PCI: form.PCI !== '' ? Number(form.PCI) : undefined,
        IRI: form.IRI !== '' ? Number(form.IRI) : undefined,
        STATE: form.STATE,
        FINDING: form.FINDING || undefined
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
      title={row ? '編輯調查點' : '新增調查點'}
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="info" sx={{ fontSize: 13 }}>
          狀態設為「已完成」且填了 PCI 與對應路段時，會**一併回寫該路段的評分** ——
          實測分數的可信度高於用案件密度推算的值。兩者在同一個交易裡。
        </Alert>

        <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
      </Stack>
    </FormDialog>
  );
}
