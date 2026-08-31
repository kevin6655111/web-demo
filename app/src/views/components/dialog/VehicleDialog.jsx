import { useEffect, useState } from 'react';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import { authApi, fleetApi, projectApi } from '../../../models/api/patrolApi';
import { VEHICLE_STATE_LABEL, VEHICLE_TYPE_LABEL } from '../../../styles/theme';

/**
 * 車輛。
 *
 * 車機識別碼與車牌分開：車牌會換（過戶、換車），車機不會 ——
 * 上傳軌跡時用的是車機識別碼，換車牌不會讓歷史軌跡對不上。
 */
export default function VehicleDialog({ open, row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!open) return;

    setForm({
      PLATE_NO: row?.PLATE_NO ?? '',
      NAME: row?.NAME ?? '',
      VEHICLE_TYPE: row?.VEHICLE_TYPE ?? 'PATROL',
      DEVICE_ID: row?.DEVICE_ID ?? '',
      DRIVER_ID: row?.DRIVER_ID ? String(row.DRIVER_ID) : '',
      PROJECT_ID: row?.PROJECT_ID ? String(row.PROJECT_ID) : '',
      STATE: row?.STATE === 'DISABLED' ? 'DISABLED' : 'OFFLINE',
      REMARK: row?.REMARK ?? ''
    });
    setErrors({});
    setError('');

    authApi.orgUsers().then((res) => setUsers((res.data ?? []).filter((u) => u.ACTIVE))).catch(() => {});
    projectApi.list().then((res) => setProjects(res.data ?? [])).catch(() => {});
  }, [open, row]);

  const fields = [
    { key: 'PLATE_NO', label: '車牌', required: true, placeholder: 'DEMO-005' },
    { key: 'NAME', label: '名稱', placeholder: '巡查五號車' },
    {
      key: 'VEHICLE_TYPE',
      label: '用途',
      type: 'select',
      required: true,
      options: Object.entries(VEHICLE_TYPE_LABEL).map(([value, label]) => ({ value, label }))
    },
    { key: 'DEVICE_ID', label: '車機識別碼', placeholder: 'DEV-0005', hint: '車機用它認自己；換車牌不影響' },
    { key: 'DRIVER_ID', label: '駕駛', type: 'select', options: users.map((u) => ({ value: String(u.ID), label: u.USER_NAME })) },
    { key: 'PROJECT_ID', label: '所屬標案', type: 'select', options: projects.map((p) => ({ value: String(p.ID), label: p.CODE })) },
    {
      key: 'STATE',
      label: '狀態',
      type: 'select',
      options: [
        { value: 'OFFLINE', label: '啟用（依回報時間判定在線）' },
        { value: 'DISABLED', label: VEHICLE_STATE_LABEL.DISABLED }
      ],
      hint: '「在線」由最後回報時間判定，不需手動設定',
      full: true
    },
    { key: 'REMARK', label: '備註', type: 'textarea', rows: 2 }
  ];

  const submit = async () => {
    if (!form.PLATE_NO?.trim()) {
      setErrors({ PLATE_NO: '必填' });
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await fleetApi.upsertVehicle({
        ID: row?.ID,
        PLATE_NO: form.PLATE_NO,
        NAME: form.NAME || undefined,
        VEHICLE_TYPE: form.VEHICLE_TYPE,
        DEVICE_ID: form.DEVICE_ID || undefined,
        DRIVER_ID: form.DRIVER_ID ? Number(form.DRIVER_ID) : undefined,
        PROJECT_ID: form.PROJECT_ID ? Number(form.PROJECT_ID) : undefined,
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
      title={row ? '編輯車輛' : '新增車輛'}
      subtitle={row ? row.PLATE_NO : '車牌在同一公司內不可重複'}
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
