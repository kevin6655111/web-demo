import { useEffect, useState } from 'react';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { caseApi, projectApi } from '../../../models/api/patrolApi';
import { opts } from '../../../config/queryFields';
import { CRACK_LABEL, DEGREE_LABEL } from '../../../styles/theme';

/**
 * 編輯案件。
 *
 * 只開放「複查後會修正」的欄位：類型、程度、尺寸、地址、標案、備註。
 *
 * 座標與原始編號不可改 —— 前者是現場設備量到的事實，
 * 後者是上游系統的鍵值，改了就對不上了。
 * 狀態走狀態變更端點，不從這裡改，否則會繞過派工單的一致性檢查。
 */
export default function CaseEditDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [projects, setProjects] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !row) return;

    setForm({
      CRACK_TYPE: row.CRACK_TYPE ?? '',
      DEGREE: row.DEGREE ?? '',
      LENGTH: row.LENGTH ?? '',
      WIDTH: row.WIDTH ?? '',
      AREA: row.AREA ?? '',
      DEPTH: row.DEPTH ?? '',
      COUNTY: row.COUNTY ?? '',
      DISTRICT: row.DISTRICT ?? '',
      CAVLGE: row.CAVLGE ?? '',
      ROAD: row.ROAD ?? '',
      ADDRESS: row.ADDRESS ?? '',
      PROJECT_ID: row.PROJECT_ID ? String(row.PROJECT_ID) : '',
      REMARK: row.REMARK ?? ''
    });
    setErrors({});
    setError('');

    projectApi
      .list()
      .then((res) => setProjects(res.data ?? []))
      .catch(() => {});
  }, [open, row]);

  const fields = [
    { key: 'CRACK_TYPE', label: '破壞類型', type: 'select', required: true, options: opts(CRACK_LABEL) },
    { key: 'DEGREE', label: '破壞程度', type: 'select', required: true, options: opts(DEGREE_LABEL) },
    { key: 'LENGTH', label: '長度', type: 'number', unit: 'm' },
    { key: 'WIDTH', label: '寬度', type: 'number', unit: 'm' },
    { key: 'AREA', label: '面積', type: 'number', unit: 'm²', hint: '會進報表與計價' },
    { key: 'DEPTH', label: '深度', type: 'number', unit: 'cm', hint: '決定用什麼工法' },
    { key: 'COUNTY', label: '縣市' },
    { key: 'DISTRICT', label: '行政區' },
    { key: 'CAVLGE', label: '里' },
    { key: 'ROAD', label: '路名' },
    { key: 'ADDRESS', label: '地址', full: true },
    {
      key: 'PROJECT_ID',
      label: '所屬標案',
      type: 'select',
      options: projects.map((p) => ({ value: String(p.ID), label: `${p.PRJ_ID} ${p.PRJ_NAME}` }))
    },
    { key: 'REMARK', label: '備註', type: 'textarea', rows: 2 }
  ];

  const NUMERIC = ['LENGTH', 'WIDTH', 'AREA', 'DEPTH', 'PROJECT_ID'];

  const validate = () => {
    const next = {};
    if (!form.CRACK_TYPE) next.CRACK_TYPE = '必填';
    if (!form.DEGREE) next.DEGREE = '必填';

    for (const key of ['LENGTH', 'WIDTH', 'AREA', 'DEPTH']) {
      if (form[key] !== '' && Number(form[key]) < 0) next[key] = '不可為負';
    }

    setErrors(next);
    return !Object.keys(next).length;
  };

  const submit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    setError('');

    try {
      // 只送有值的欄位：後端會把每個變更寫成新版本，送空值等於把資料清掉
      const body = { ID: row.ID };
      for (const [k, v] of Object.entries(form)) {
        if (v === '' || v === null || v === undefined) continue;
        body[k] = NUMERIC.includes(k) ? Number(v) : v;
      }

      await caseApi.update(body);
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
      title="編輯案件"
      subtitle={row ? `${row.CASE_NUM ?? row.EXTERNAL_ID}　每次修改都會寫入一個新版本` : ''}
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
