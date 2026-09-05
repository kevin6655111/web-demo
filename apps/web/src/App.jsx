import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress, LinearProgress } from '@mui/material';
import { useUser } from './context/UserContext';
import AppShell from './views/components/AppShell';
import LoginView from './views/LoginView';
import CaseView from './views/CaseView';
import OrderModView from './views/OrderModView';
import ReportView from './views/ReportView';
import ManageView from './views/ManageView';

// 地圖(leaflet)與圖表(recharts)加起來超過 400KB，只有真的開到才下載
const DashboardView = lazy(() => import('./views/DashboardView'));
const MapView = lazy(() => import('./views/map/MapView'));

/**
 * 路由。
 *
 * 路徑與後端導覽定義的 `MODULE_PATH` 對應 ——
 * 新增模組時後端改 MODULE_DEF、前端在這裡補一條路由即可。
 */
export default function App() {
  const { user, loading } = useUser();

  // 還在問「我是誰」時不要先渲染登入頁：重新整理會閃一下登入畫面
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<LinearProgress />}>
        <Routes>
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/case" element={<CaseView />} />
          <Route path="/workorder" element={<OrderModView />} />
          <Route path="/report" element={<ReportView />} />
          <Route path="/manage" element={<ManageView />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
