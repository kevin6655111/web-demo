import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CampaignIcon from '@mui/icons-material/Campaign';
import CompanyDialog from './components/dialog/CompanyDialog';
import ProjectDialog from './components/dialog/ProjectDialog';
import UserDialog from './components/dialog/UserDialog';
import RoleDialog from './components/dialog/RoleDialog';
import VehicleDialog from './components/dialog/VehicleDialog';
import PlanDialog from './components/dialog/PlanDialog';
import AnnouncementDialog from './components/dialog/AnnouncementDialog';
import ConfirmDialog from './components/dialog/ConfirmDialog';
import DataTable, { ProgressBar, StatusChip } from './components/query/DataTable';
import QueryForm from './components/query/QueryForm';
import {
  authApi,
  companyApi,
  coreApi,
  fleetApi,
  patrolPlanApi,
  projectApi,
  taskApi
} from '../models/api/patrolApi';
import { CasePresenter } from '../presenters/CasePresenter';
import {
  PROJECT_STATE_LABEL,
  VEHICLE_STATE_COLOR,
  VEHICLE_STATE_LABEL,
  VEHICLE_TYPE_LABEL
} from '../config/vocabulary';
import { useUser } from '../context/UserContext';

const FREQ_LABEL = { DAILY: '每日', WEEKLY: '每週', BIWEEKLY: '雙週', MONTHLY: '每月' };

/**
 * 系統管理。
 *
 * 分頁而不是六個側邊欄項目：這些設定平常不會動，
 * 但要動的時候通常是一起動(新標案 → 配車輛 → 排巡查路線)。
 */
export default function ManageView() {
  const { can } = useUser();
  const [tab, setTab] = useState('project');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 每個分頁對應一個表單；null = 關閉、{} = 新增、{...row} = 編輯
  const [dialog, setDialog] = useState({ kind: null, row: null });
  const [confirm, setConfirm] = useState(null);
  const [coverageRange, setCoverageRange] = useState({
    DATE_START: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    DATE_END: new Date().toISOString().slice(0, 10)
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        projects,
        roles,
        users,
        vehicles,
        plans,
        coverage,
        tasks,
        announcements,
        subCompanies,
        grantable
      ] = await Promise.all([
        projectApi.list().catch(() => ({ data: [] })),
        authApi.roles().catch(() => ({ data: [] })),
        authApi.orgUsers().catch(() => ({ data: [] })),
        fleetApi.vehicles({}).catch(() => ({ data: [] })),
        patrolPlanApi.list({}).catch(() => ({ data: [] })),
        patrolPlanApi.coverage(coverageRange).catch(() => ({ data: { PLANS: [] } })),
        can('TASK.READ') ? taskApi.status() : Promise.resolve({ data: [] }),
        coreApi.announcements().catch(() => ({ data: [] })),
        can('ACCOUNT.READ') ? companyApi.list().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        can('ACCOUNT.UPDATE') ? companyApi.grantable().catch(() => ({ data: null })) : Promise.resolve({ data: null })
      ]);

      setData({
        projects: projects.data ?? [],
        roles: roles.data ?? [],
        users: users.data ?? [],
        vehicles: vehicles.data ?? [],
        plans: plans.data ?? [],
        coverage: coverage.data ?? { PLANS: [] },
        tasks: tasks.data ?? [],
        announcements: announcements.data ?? [],
        subCompanies: subCompanies.data ?? [],
        grantable: grantable.data ?? null
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [can, coverageRange]);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async (key) => {
    try {
      const res = await taskApi.trigger(key);
      setNotice(`${res.message}（${key}）`);
      setTimeout(load, 2500);
    } catch (err) {
      setError(err.message);
    }
  };

  const TABLES = useMemo(
    () => ({
      project: {
        label: '標案',
        canAdd: can('PROJECT.CREATE'),
        columns: [
          { key: 'PRJ_ID', label: '標案號', mono: true },
          { key: 'PRJ_NO', label: '標案編號', mono: true },
          { key: 'PRJ_NAME', label: '名稱', wrap: true },
          { key: 'PROPRIETOR', label: '業主' },
          {
            key: 'STATE',
            label: '狀態',
            render: (v) => (
              <StatusChip
                label={PROJECT_STATE_LABEL[v] ?? v}
                color={v === 'ACTIVE' ? 'var(--c-success)' : 'var(--c-neutral)'}
              />
            )
          },
          { key: 'START_DATE', label: '起' },
          { key: 'END_DATE', label: '迄' },
          { key: 'ROAD_KM', label: '里程 km', type: 'number', digits: 1 },
          { key: 'CASE_TOTAL', label: '案件', type: 'number', digits: 0 },
          { key: 'DISPATCH_RATE', label: '派工率', align: 'right', render: (v) => <ProgressBar value={v} /> }
        ],
        rows: data.projects ?? []
      },
      subCompany: {
        label: '下層單位',
        canAdd: can('ACCOUNT.CREATE') && data.grantable?.CAN_CREATE_SUB,
        columns: [
          { key: 'CODE', label: '單位代碼', mono: true },
          { key: 'NAME', label: '名稱', wrap: true },
          { key: 'TIER_NAME', label: '層級' },
          { key: 'PARENT_NAME', label: '上層單位' },
          {
            key: 'USER_COUNT',
            label: '人員',
            render: (v, row) => (
              <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {v} / {row.USER_LIMIT}
              </Typography>
            )
          },
          { key: 'GRANT_COUNT', label: '已開通', type: 'number', digits: 0 },
          {
            key: 'IS_ACTIVE',
            label: '狀態',
            render: (v) => <StatusChip label={v ? '啟用' : '停用'} color={v ? 'var(--c-success)' : 'var(--c-error)'} />
          },
          { key: 'DESCRIPTION', label: '說明', wrap: true }
        ],
        rows: data.subCompanies ?? [],
        // 只看得到自己的子樹 —— 廠商查不到平台，也查不到別的廠商
        empty: '底下沒有單位'
      },
      account: {
        label: '人員',
        canAdd: can('ACCOUNT.CREATE'),
        columns: [
          { key: 'ACCOUNT', label: '帳號', mono: true },
          { key: 'USER_NAME', label: '姓名' },
          { key: 'ROLE', label: '角色' },
          {
            key: 'ACTIVE',
            label: '狀態',
            render: (v) => <StatusChip label={v ? '啟用' : '停用'} color={v ? 'var(--c-success)' : 'var(--c-error)'} />
          },
          { key: 'LAST_LOGIN_AT', label: '最後登入', render: (v) => (v ? CasePresenter.time(v) : '—') }
        ],
        rows: data.users ?? []
      },
      role: {
        label: '角色權限',
        canAdd: can('ACCOUNT.CREATE'),
        columns: [
          { key: 'KEY', label: '代號', mono: true },
          { key: 'NAME', label: '角色' },
          { key: 'USER_COUNT', label: '人數', type: 'number', digits: 0 },
          {
            key: 'ACTIONS',
            label: '權限',
            wrap: true,
            render: (v) => (
              <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
                {v.slice(0, 8).map((a) => (
                  <Chip
                    key={a}
                    size="small"
                    label={a}
                    sx={{ height: 19, fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}
                  />
                ))}
                {v.length > 8 && <Chip size="small" label={`+${v.length - 8}`} sx={{ height: 19, fontSize: 10 }} />}
              </Stack>
            )
          }
        ],
        rows: data.roles ?? []
      },
      vehicle: {
        label: '車輛',
        canAdd: can('FLEET.UPDATE'),
        columns: [
          { key: 'PLATE_NO', label: '車牌', mono: true },
          { key: 'NAME', label: '名稱' },
          { key: 'VEHICLE_TYPE', label: '用途', render: (v) => VEHICLE_TYPE_LABEL[v] ?? v },
          {
            key: 'STATE',
            label: '狀態',
            render: (v) => <StatusChip label={VEHICLE_STATE_LABEL[v] ?? v} color={VEHICLE_STATE_COLOR[v]} />
          },
          { key: 'DEVICE_ID', label: '車機', mono: true },
          { key: 'DRIVER', label: '駕駛' },
          { key: 'TODAY_KM', label: '今日 km', type: 'number', digits: 1 },
          { key: 'LAST_REPORT_AT', label: '最後回報', render: (v) => (v ? CasePresenter.time(v) : '—') }
        ],
        rows: data.vehicles ?? []
      },
      plan: {
        label: '巡查設定',
        canAdd: can('PROJECT.UPDATE'),
        columns: [
          { key: 'CODE', label: '代號', mono: true },
          { key: 'NAME', label: '計畫名稱' },
          { key: 'FREQUENCY', label: '頻率', render: (v) => FREQ_LABEL[v] ?? v },
          { key: 'VEHICLE', label: '指派車輛', mono: true },
          { key: 'ROUTE_KM', label: '路線 km', type: 'number', digits: 2 },
          { key: 'BUFFER_M', label: '緩衝 m', type: 'number', digits: 0 },
          {
            key: 'ACTIVE',
            label: '啟用',
            render: (v) => (
              <StatusChip label={v ? '啟用' : '停用'} color={v ? 'var(--c-success)' : 'var(--c-neutral)'} />
            )
          }
        ],
        rows: data.plans ?? []
      },
      announcement: {
        label: '公告',
        canAdd: can('ACCOUNT.UPDATE'),
        columns: [
          { key: 'TITLE', label: '標題', wrap: true },
          {
            key: 'LEVEL',
            label: '層級',
            render: (v) => (
              <StatusChip
                label={{ INFO: '一般', WARNING: '注意', CRITICAL: '重要' }[v] ?? v}
                color={{ INFO: 'var(--c-info)', WARNING: 'var(--c-warning)', CRITICAL: 'var(--c-error)' }[v]}
              />
            )
          },
          { key: 'PINNED', label: '置頂', render: (v) => (v ? '是' : '—') },
          { key: 'START_AT', label: '開始', render: (v) => CasePresenter.time(v) },
          { key: 'END_AT', label: '結束', render: (v) => (v ? CasePresenter.time(v) : '永久') },
          { key: 'AUTHOR', label: '發布者' },
          {
            key: 'ID',
            label: '',
            align: 'right',
            render: (v, row) => (
              <IconButton
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({
                    title: '刪除公告',
                    message: `確定刪除「${row.TITLE}」？`,
                    danger: true,
                    onConfirm: async () => {
                      await coreApi.deleteAnnouncement(v);
                      setConfirm(null);
                      load();
                    }
                  });
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            )
          }
        ],
        rows: data.announcements ?? []
      },
    }),
    [data, can, load]
  );

  if (loading) return <LinearProgress />;

  const table = TABLES[tab];

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="info">{notice}</Alert>}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
      >
        {Object.entries(TABLES).map(([key, t]) => (
          <Tab key={key} value={key} label={`${t.label} (${t.rows.length})`} />
        ))}
        {can('TASK.READ') && <Tab value="task" label={`排程 (${data.tasks?.length ?? 0})`} />}
        <Tab value="coverage" label="巡查覆蓋率" />
      </Tabs>

      {table && (
        <Stack spacing={1.5}>
          {table.canAdd && (
            <Button
              size="small"
              variant="contained"
              startIcon={tab === 'announcement' ? <CampaignIcon /> : <AddIcon />}
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => setDialog({ kind: tab, row: null })}
            >
              新增{table.label}
            </Button>
          )}

          <DataTable
            columns={table.columns}
            rows={table.rows}
            onRowClick={(row) => setDialog({ kind: tab, row })}
            emptyText={`尚無${table.label}資料`}
          />
        </Stack>
      )}

      {tab === 'task' && (
        <DataTable
          columns={[
            { key: 'LABEL', label: '排程' },
            { key: 'CRON', label: 'cron', mono: true },
            {
              key: 'ENABLED',
              label: '狀態',
              render: (v, row) => (
                <StatusChip
                  label={row.RUNNING ? '執行中' : v ? '啟用' : '停用'}
                  color={row.RUNNING ? 'var(--c-info)' : v ? 'var(--c-success)' : 'var(--c-neutral)'}
                />
              )
            },
            { key: 'LAST_RUN', label: '上次完成', render: (v) => (v ? CasePresenter.time(v) : '—') },
            {
              key: 'KEY',
              label: '手動觸發',
              align: 'right',
              render: (v, row) => (
                <Button
                  size="small"
                  startIcon={<PlayArrowIcon />}
                  disabled={!can('TASK.RUN') || row.RUNNING}
                  onClick={() => trigger(v)}
                >
                  執行
                </Button>
              )
            }
          ]}
          rows={data.tasks ?? []}
          emptyText="scheduler 尚未回報狀態"
        />
      )}

      <CompanyDialog
        open={dialog.kind === 'subCompany'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <ProjectDialog
        open={dialog.kind === 'project'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <UserDialog
        open={dialog.kind === 'account'}
        row={dialog.row}
        roles={data.roles ?? []}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <RoleDialog
        open={dialog.kind === 'role'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <VehicleDialog
        open={dialog.kind === 'vehicle'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <PlanDialog
        open={dialog.kind === 'plan'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <AnnouncementDialog
        open={dialog.kind === 'announcement'}
        row={dialog.row}
        onClose={() => setDialog({ kind: null, row: null })}
        onSaved={() => {
          setDialog({ kind: null, row: null });
          load();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger={confirm?.danger}
        confirmLabel="刪除"
        onConfirm={confirm?.onConfirm}
        onClose={() => setConfirm(null)}
      />

      {tab === 'coverage' && (
        <Stack spacing={2}>
          <QueryForm
            fields={[
              { key: 'DATE_START', label: '起始日', type: 'date' },
              { key: 'DATE_END', label: '結束日', type: 'date' }
            ]}
            value={coverageRange}
            onChange={setCoverageRange}
            onSearch={load}
            onReset={() => setCoverageRange({ DATE_START: '', DATE_END: '' })}
            dense
          />

          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  平均覆蓋率
                </Typography>
                <Typography variant="h5" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {data.coverage?.AVG_COVERAGE ?? 0}%
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  未達 80%
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: data.coverage?.UNDER_TARGET ? 'error.main' : 'inherit'
                  }}
                >
                  {data.coverage?.UNDER_TARGET ?? 0} 條
                </Typography>
              </Box>
            </Stack>
          </Paper>

          <DataTable
            columns={[
              { key: 'CODE', label: '代號', mono: true },
              { key: 'NAME', label: '計畫' },
              { key: 'FREQUENCY', label: '頻率', render: (v) => FREQ_LABEL[v] ?? v },
              { key: 'VEHICLE', label: '車輛', mono: true },
              { key: 'ROUTE_KM', label: '路線 km', type: 'number', digits: 2 },
              { key: 'POINTS', label: '軌跡點', type: 'number', digits: 0 },
              {
                key: 'COVERAGE',
                label: '覆蓋率',
                align: 'right',
                render: (v) => (
                  <ProgressBar
                    value={v}
                    color={v >= 80 ? 'var(--c-success)' : v >= 50 ? 'var(--c-warning)' : 'var(--c-error)'}
                  />
                )
              }
            ]}
            rows={data.coverage?.PLANS ?? []}
            emptyText="沒有啟用中的巡查計畫"
          />
        </Stack>
      )}
    </Stack>
  );
}
