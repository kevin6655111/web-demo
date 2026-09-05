import { useMemo, useState } from 'react';
import { Alert, Stack, Tab, Tabs } from '@mui/material';
import MaintenanceView from './MaintenanceView';
import WorkOrderView from './WorkOrderView';
import { useUser } from '../context/UserContext';

/**
 * 派工管理模組的外框。
 *
 * 巡查單與派工單是同一條流程的兩段：先發現、再派工。
 * 放在同一頁的兩個分頁而不是兩個路由 —— 承辦在這兩張表之間來回，
 * 是「看到這張巡查單，去看它的派工單」這件事，不該讓瀏覽器換頁。
 *
 * 分頁依權限顯示：看得到卻按了就 403 是最糟的介面。
 */
export default function OrderModView() {
  const { can } = useUser();

  const tabs = useMemo(
    () =>
      [
        can('MAINTENANCE.READ') && { value: 'maintenance', label: '巡查單' },
        can('WORK_ORDER.READ') && { value: 'workorder', label: '派工單' }
      ].filter(Boolean),
    [can]
  );

  const [tab, setTab] = useState(tabs[0]?.value);

  if (!tabs.length) return <Alert severity="warning">沒有巡查單或派工單的檢視權限。</Alert>;

  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <Stack spacing={2}>
      {/* 只有一種權限時不顯示分頁列：一個分頁的分頁列只是佔位置 */}
      {tabs.length > 1 && (
        <Tabs
          value={current}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
        >
          {tabs.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      )}

      {current === 'maintenance' ? <MaintenanceView /> : <WorkOrderView />}
    </Stack>
  );
}
