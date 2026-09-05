import { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { authApi, workOrderApi } from '../../../models/api/patrolApi';
import { opts } from '../../../config/queryFields';
import { MATERIAL_LABEL, WORK_UNIT_LABEL } from '../../../config/vocabulary';

/**
 * 由案件或巡查單派工。
 *
 * 類型由來源決定而不是讓人選：車巡案件轉出來的是 PC、巡查單是 PD ——
 * 讓人選只會選錯，而選錯的單在報表裡會歸到錯的類別。
 *
 * `source` 只影響「來源 id 掛在哪個欄位」與少數欄位的預設值；
 * 兩種來源共用同一張表單，因為派工要填的東西本來就一樣。
 *
 * 施工人員清單只列啟用中的帳號 —— 派給停用帳號的單會永遠停在「待處理」。
 */
export default function DispatchDialog({ open, caseRow, source = 'CASE', onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [workers, setWorkers] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !caseRow) return;

    // 預設派工日是今天、限期三天後：現場的常態，要改再改
    const today = new Date();
    const due = new Date(Date.now() + 3 * 86400000);

    const fromMaintenance = source === 'MAINTENANCE';

    setForm({
      WORKER_USER_ID: [],
      WORK_UNIT: 'SELF',
      DISPATCH_DATE: today.toISOString().slice(0, 10),
      DUE_DATE: due.toISOString().slice(0, 10),
      COUNTY: caseRow.COUNTY ?? '',
      DISTRICT: caseRow.DISTRICT ?? '',
      CAVLGE: caseRow.CAVLGE ?? '',
      ADDRESS: caseRow.ADDRESS ?? caseRow.ROAD ?? '',
      MATERIAL: '',
      MATERIAL_SIZE: '',
      // 巡查單量的是破壞尺寸，案件量的也是 —— 欄位名不同，意思一樣
      WORK_LENGTH: (fromMaintenance ? caseRow.DTYPE_LENGTH : caseRow.LENGTH) ?? '',
      WORK_WIDTH: (fromMaintenance ? caseRow.DTYPE_WIDTH : caseRow.WIDTH) ?? '',
      WORK_DEPTH_MILLING: '',
      WORK_DEPTH_PAVING: '',
      REMARK: ''
    });
    setErrors({});
    setError('');

    authApi
      .orgUsers()
      .then((res) => setWorkers((res.data ?? []).filter((u) => u.ACTIVE)))
      .catch(() => {});
  }, [open, caseRow, source]);

  const fields = [
    {
      // 可多人也可以先不指派：現場常是先開單、隔天早上點名才分工
      key: 'WORKER_USER_ID',
      label: '施工人員',
      type: 'multi',
      hint: '可多人；先不指派也可以，單會停在「待處理」',
      options: workers.map((u) => ({ value: u.ID, label: `${u.USER_NAME}（${u.ROLE}）` }))
    },
    { key: 'WORK_UNIT', label: '施工單位', type: 'select', required: true, options: opts(WORK_UNIT_LABEL) },
    { key: 'DISPATCH_DATE', label: '派工日', type: 'date', required: true },
    { key: 'DUE_DATE', label: '限期完工日', type: 'date', hint: '逾期未完工會在看板與儀表板標紅' },
    { key: 'COUNTY', label: '縣市' },
    { key: 'DISTRICT', label: '行政區', required: true },
    { key: 'CAVLGE', label: '里' },
    { key: 'ADDRESS', label: '施工地址', required: true, full: true },
    { key: 'MATERIAL', label: '施工材料', type: 'select', options: opts(MATERIAL_LABEL) },
    { key: 'MATERIAL_SIZE', label: '材料粒徑', type: 'number', unit: 'mm' },
    { key: 'WORK_LENGTH', label: '施工長度', type: 'number', unit: 'm' },
    { key: 'WORK_WIDTH', label: '施工寬度', type: 'number', unit: 'm' },
    { key: 'WORK_DEPTH_MILLING', label: '刨除深度', type: 'number', unit: 'cm' },
    { key: 'WORK_DEPTH_PAVING', label: '鋪築深度', type: 'number', unit: 'cm' },
    { key: 'REMARK', label: '備註', type: 'textarea', rows: 2 }
  ];

  const NUMERIC = ['MATERIAL_SIZE', 'WORK_LENGTH', 'WORK_WIDTH', 'WORK_DEPTH_MILLING', 'WORK_DEPTH_PAVING'];

  const submit = async () => {
    const next = {};
    if (!form.WORK_UNIT) next.WORK_UNIT = '必填';
    if (!form.DISPATCH_DATE) next.DISPATCH_DATE = '必填';
    if (!form.DISTRICT) next.DISTRICT = '必填';
    if (!form.ADDRESS) next.ADDRESS = '必填';

    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    setError('');

    try {
      const fromMaintenance = source === 'MAINTENANCE';

      const body = {
        // 來源決定派工類型，兩者不該各自為政
        TYPE: fromMaintenance ? 'PD' : 'PC',
        PRJ_ID: caseRow.PRJ_ID,
        ...(fromMaintenance ? { MAINTENANCE_ID: caseRow.ID } : { CASE_PATROL_ID: caseRow.ID }),
        START_LNG: caseRow.LNG,
        START_LAT: caseRow.LAT
      };

      for (const [k, v] of Object.entries(form)) {
        // 施工人員是陣列，空陣列代表「先不指派」，不能被空值過濾掉
        if (k === 'WORKER_USER_ID') {
          body[k] = (Array.isArray(v) ? v : v ? [v] : []).map(Number).filter(Boolean);
          continue;
        }
        if (v === '' || v === null || v === undefined) continue;
        body[k] = NUMERIC.includes(k) ? Number(v) : v;
      }

      await workOrderApi.create(body);
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
      title="派工"
      subtitle={caseRow ? `${caseRow.CASE_NUM ?? caseRow.EXTERNAL_ID}　${caseRow.ROAD ?? caseRow.ADDRESS ?? ''}` : ''}
      submitLabel="送出派工"
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        <Alert severity="info" sx={{ fontSize: 13 }}>
          派工單與來源單的狀態在同一個交易裡更新。一張來源單同時只能有一張有效派工單 ——
          重複派工在現場就是兩班人去修同一個坑。
        </Alert>

        <FormFields fields={fields} value={form} errors={errors} onChange={setForm} />
      </Stack>
    </FormDialog>
  );
}
