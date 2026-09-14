import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, Divider, LinearProgress, Stack, Tab, Tabs, Typography } from '@mui/material';
import FormDialog from './FormDialog';
import { FormFields } from '../form/FormFields';
import SearchableSelect from '../form/SearchableSelect';
import { authApi, fleetApi, projectApi } from '../../../models/api/patrolApi';
import { opts } from '../../../config/queryFields';
import { PROJECT_STATE_LABEL } from '../../../config/vocabulary';

const LEVEL_OPTIONS = [
  { value: '1', label: '中央' },
  { value: '2', label: '直轄市' },
  { value: '3', label: '縣市' },
  { value: '4', label: '鄉鎮' }
];

/**
 * 標案。
 *
 * **標案是整個系統的分區單位**：案件、車輛、報表、驗收、請款都以它為界。
 * 所以這個表單不只是幾個欄位 —— 還要把「誰在做、哪些車在跑、哪些行政區歸誰」設定好，
 * 少了關聯的標案是查得到但用不了的。
 *
 * 標案號(`PRJ_ID`)與標案編號(`PRJ_NO`)是兩件事：前者進案件編號當前綴，
 * 後者是招標文件上的正式編號。合成一個欄位的話，案件編號會變得又長又難念。
 *
 * 新增時只收基本資料 —— 關聯要先有標案 id 才掛得上去，
 * 硬要在同一步完成，中途失敗會留下一個掛了一半的標案。
 */
export default function ProjectDialog({ open, row, onClose, onSaved }) {
  const [tab, setTab] = useState('basic');
  const [form, setForm] = useState({});
  const [detail, setDetail] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 關聯的選項來源
  const [vehicles, setVehicles] = useState([]);
  const [sections, setSections] = useState([]);
  const [areas, setAreas] = useState([]);
  const [companies, setCompanies] = useState([]);

  // 關聯的目前狀態
  const [pickedVehicles, setPickedVehicles] = useState([]);
  const [pickedSections, setPickedSections] = useState({});
  const [pickedCompanies, setPickedCompanies] = useState([]);

  const editing = !!row;

  const load = useCallback(async () => {
    if (!row?.ID) return;

    setLoading(true);
    try {
      const res = await projectApi.detail(row.ID);
      const d = res.data;

      setDetail(d);
      setPickedVehicles((d.VEHICLES ?? []).filter((v) => v.IS_ACTIVE).map((v) => v.ID));
      setPickedCompanies((d.COMPANIES ?? []).filter((c) => c.IS_ACTIVE).map((c) => c.ID));
      setPickedSections(
        Object.fromEntries(
          (d.SECTIONS ?? [])
            .filter((s) => s.IS_ACTIVE && s.SECTION_ID)
            .map((s) => [s.SECTION_ID, (s.AREAS ?? []).map((a) => a.ID)])
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [row?.ID]);

  useEffect(() => {
    if (!open) return;

    setTab('basic');
    setError('');
    setNotice('');
    setErrors({});

    setForm(
      row
        ? {
            PRJ_NO: row.PRJ_NO ?? '',
            PRJ_NAME: row.PRJ_NAME ?? '',
            PRJ_MAIN: row.PRJ_MAIN ?? '',
            PRJ_SUB: row.PRJ_SUB ?? '',
            PROPRIETOR: row.PROPRIETOR ?? '',
            PROPRIETOR_LEVEL: String(row.PROPRIETOR_LEVEL ?? 3),
            STATE: row.STATE ?? 'DRAFT'
          }
        : {
            PRJ_ID: '',
            PRJ_NO: '',
            PRJ_NAME: '',
            PRJ_MAIN: '',
            PRJ_SUB: '',
            PROPRIETOR: '',
            PROPRIETOR_LEVEL: '3',
            START_DATE: '',
            END_DATE: '',
            BUDGET: '',
            ROAD_KM: ''
          }
    );

    if (row) load();

    // 關聯的選項只在編輯時用得到，但先抓起來，切分頁時才不用等
    fleetApi
      .vehicles()
      .then((res) => setVehicles(res.data ?? []))
      .catch(() => {});
    projectApi
      .sections()
      .then((res) => setSections(res.data ?? []))
      .catch(() => {});
    projectApi
      .areas()
      .then((res) => setAreas(res.data ?? []))
      .catch(() => {});
    authApi
      .orgUsers()
      .then(() => {})
      .catch(() => {});
    setCompanies([]);
  }, [open, row, load]);

  const basicFields = useMemo(
    () =>
      [
        !editing && {
          key: 'PRJ_ID',
          label: '系統編號',
          required: true,
          placeholder: 'DEMO02',
          hint: '會成為案件編號的前綴，越短越好'
        },
        { key: 'PRJ_NO', label: '案號', placeholder: '1150101-001', hint: '招標文件上的正式編號' },
        { key: 'PRJ_NAME', label: '標案簡稱', required: true },
        { key: 'PRJ_SUB', label: '標案子項', placeholder: '第一標' },
        { key: 'PRJ_MAIN', label: '標案全名', required: true, full: true },
        { key: 'PROPRIETOR', label: '業主單位', required: true },
        {
          key: 'PROPRIETOR_LEVEL',
          label: '業主等級',
          type: 'select',
          required: true,
          options: LEVEL_OPTIONS,
          hint: '影響報表格式與上傳規則'
        },
        !editing && { key: 'START_DATE', label: '日期(起)', type: 'date', required: true },
        !editing && { key: 'END_DATE', label: '日期(迄)', type: 'date', required: true },
        !editing && { key: 'BUDGET', label: '契約金額', type: 'number', unit: '元' },
        !editing && { key: 'ROAD_KM', label: '巡查里程', type: 'number', unit: 'km' },
        editing && {
          key: 'STATE',
          label: '標案狀態',
          type: 'select',
          required: true,
          full: true,
          options: opts(PROJECT_STATE_LABEL),
          hint: '只有「執行中」的標案會被案件自動編碼排程認列'
        }
      ].filter(Boolean),
    [editing]
  );

  const areaOptions = useMemo(() => areas.map((a) => ({ value: a.ID, label: `${a.COUNTY} ${a.DISTRICT}` })), [areas]);

  /** 區域摘要：每個工務段負責哪些行政區 —— 設定完要能一眼複查 */
  const areaSummary = useMemo(() => {
    const picked = Object.entries(pickedSections);
    if (!picked.length) return '尚未設定';

    return picked
      .map(([sectionId, areaIds]) => {
        const name = sections.find((s) => String(s.ID) === String(sectionId))?.NAME ?? sectionId;
        const list = areaIds.map((id) => areas.find((a) => a.ID === id)?.DISTRICT).filter(Boolean);
        return `${name}：${list.length ? list.join('、') : '無'}`;
      })
      .join('\n');
  }, [pickedSections, sections, areas]);

  const vehicleSummary = useMemo(
    () =>
      pickedVehicles.length
        ? pickedVehicles
            .map((id) => vehicles.find((v) => v.ID === id)?.PLATE_NO)
            .filter(Boolean)
            .join('、')
        : '尚未配置',
    [pickedVehicles, vehicles]
  );

  const saveBasic = async () => {
    const next = {};
    const required = editing
      ? ['PRJ_NAME', 'PRJ_MAIN', 'PROPRIETOR']
      : ['PRJ_ID', 'PRJ_NAME', 'PRJ_MAIN', 'PROPRIETOR', 'START_DATE', 'END_DATE'];
    for (const key of required) if (!String(form[key] ?? '').trim()) next[key] = '必填';

    setErrors(next);
    if (Object.keys(next).length) return false;

    if (editing) {
      // 目前只開放改狀態；其餘欄位一旦有案件掛上去就不該再動
      await projectApi.updateState({ ID: row.ID, STATE: form.STATE });
      return true;
    }

    await projectApi.create({
      PRJ_ID: form.PRJ_ID,
      PRJ_NO: form.PRJ_NO || undefined,
      PRJ_NAME: form.PRJ_NAME,
      PRJ_MAIN: form.PRJ_MAIN,
      PRJ_SUB: form.PRJ_SUB || undefined,
      PROPRIETOR: form.PROPRIETOR,
      PROPRIETOR_LEVEL: Number(form.PROPRIETOR_LEVEL ?? 3),
      START_DATE: form.START_DATE,
      END_DATE: form.END_DATE,
      BUDGET: form.BUDGET ? Number(form.BUDGET) : undefined,
      ROAD_KM: form.ROAD_KM ? Number(form.ROAD_KM) : undefined
    });

    return true;
  };

  /** 關聯逐項送出：三種關聯共用同一支端點，形狀一樣 */
  const saveRelations = async () => {
    const current = detail ?? {};

    // 車輛：新增與移除都要送 —— 只送新增的話，取消勾選不會生效
    const beforeVehicles = (current.VEHICLES ?? []).filter((v) => v.IS_ACTIVE).map((v) => v.ID);
    for (const id of new Set([...beforeVehicles, ...pickedVehicles])) {
      const want = pickedVehicles.includes(id);
      if (want === beforeVehicles.includes(id)) continue;

      await projectApi.upsertRelation({ PROJECT_ID: row.ID, KIND: 'VEHICLE', TARGET_ID: id, IS_ACTIVE: want });
    }

    const beforeSections = (current.SECTIONS ?? []).filter((s) => s.IS_ACTIVE && s.SECTION_ID).map((s) => s.SECTION_ID);
    for (const id of new Set([...beforeSections, ...Object.keys(pickedSections).map(Number)])) {
      const want = pickedSections[id] !== undefined;

      await projectApi.upsertRelation({
        PROJECT_ID: row.ID,
        KIND: 'SECTION',
        TARGET_ID: id,
        IS_ACTIVE: want,
        AREA_IDS: want ? pickedSections[id] : undefined
      });
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (tab === 'relation' && editing) {
        await saveRelations();
        setNotice('關聯已更新');
        await load();
      } else {
        const ok = await saveBasic();
        if (!ok) {
          setSubmitting(false);
          return;
        }
      }

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
      title={editing ? `${row.PRJ_ID}　${row.PRJ_NAME}` : '新增標案'}
      subtitle={
        editing
          ? '標案是案件、車輛、報表與請款的分區單位'
          : '新標案預設為草稿，簽約後改為執行中；關聯要建立完成後才能設定'
      }
      onClose={onClose}
      onSubmit={submit}
      submitting={submitting}
      error={error}
      onErrorClose={() => setError('')}
    >
      <Stack spacing={2}>
        {loading && <LinearProgress />}

        {notice && (
          <Alert severity="success" onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}

        {editing && (
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, textTransform: 'none' } }}
          >
            <Tab value="basic" label="基本資料" />
            <Tab
              value="relation"
              label={`區域與車輛（${pickedVehicles.length} 車 / ${Object.keys(pickedSections).length} 段）`}
            />
          </Tabs>
        )}

        {tab === 'basic' && (
          <>
            <FormFields fields={basicFields} value={form} errors={errors} onChange={setForm} />

            {editing && (
              <Alert severity="info" sx={{ fontSize: 13 }}>
                標案號、名稱與期間建立後不再開放修改 —— 案件編號已經用了標案號當前綴，
                改了會讓既有案件的編號對不上任何一個標案。要換就開新標案。
              </Alert>
            )}
          </>
        )}

        {tab === 'relation' && editing && (
          <Stack spacing={2}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              關聯是**停用而不是刪除** —— 換廠商、車輛調度、轄區調整都是常態，
              但去年的案件仍然要查得到當時是誰在做、哪台車跑的。
            </Alert>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                承包公司
              </Typography>
              <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                {(detail?.COMPANIES ?? []).map((c) => (
                  <Chip
                    key={c.ID}
                    size="small"
                    variant="outlined"
                    color={c.ROLE === 'MAIN' ? 'primary' : 'default'}
                    label={`${c.NAME}（${c.ROLE === 'MAIN' ? '主辦' : '協力'}）`}
                  />
                ))}
                {!detail?.COMPANIES?.length && (
                  <Typography variant="body2" color="text.disabled">
                    尚未設定
                  </Typography>
                )}
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                車牌號
              </Typography>
              <SearchableSelect
                multiple
                placeholder="選擇這個標案要跑的車輛"
                value={pickedVehicles}
                options={vehicles.map((v) => ({ value: v.ID, label: `${v.PLATE_NO} ${v.NAME ?? ''}` }))}
                onChange={setPickedVehicles}
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                工務段與轄區
              </Typography>

              <Stack spacing={1}>
                {sections.map((sec) => {
                  const on = pickedSections[sec.ID] !== undefined;

                  return (
                    <Box
                      key={sec.ID}
                      sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1.5, p: 1.2 }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: on ? 1 : 0 }}>
                        <Chip
                          size="small"
                          label={sec.NAME}
                          color={on ? 'primary' : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          onClick={() =>
                            setPickedSections((prev) => {
                              const next = { ...prev };
                              if (on) delete next[sec.ID];
                              else next[sec.ID] = [];
                              return next;
                            })
                          }
                          sx={{ cursor: 'pointer' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {on ? `負責 ${pickedSections[sec.ID].length} 個行政區` : '點擊納入這個標案'}
                        </Typography>
                      </Stack>

                      {/* 轄區掛在「標案-工務段」之下：同一個工務段在不同標案負責的行政區可以不同 */}
                      {on && (
                        <SearchableSelect
                          multiple
                          placeholder="選擇這個工務段負責的行政區"
                          value={pickedSections[sec.ID]}
                          options={areaOptions}
                          onChange={(v) => setPickedSections((prev) => ({ ...prev, [sec.ID]: v }))}
                        />
                      )}
                    </Box>
                  );
                })}

                {!sections.length && (
                  <Typography variant="body2" color="text.disabled">
                    尚未建立工務段
                  </Typography>
                )}
              </Stack>
            </Box>

            <Divider />

            {/* 摘要：設定完要能一眼複查，而不是再點開每一個工務段確認 */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                資訊摘要
              </Typography>
              <Stack spacing={0.6}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    區域摘要
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {areaSummary}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    車輛摘要
                  </Typography>
                  <Typography variant="body2">{vehicleSummary}</Typography>
                </Box>
              </Stack>
            </Box>
          </Stack>
        )}
      </Stack>
    </FormDialog>
  );
}
