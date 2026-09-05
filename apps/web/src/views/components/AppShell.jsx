import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Skeleton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  alpha
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useUser } from '../../context/UserContext';
import { useThemeMode } from '../../context/ThemeContext';
import { useSidebarConfig } from '../../hooks/useSidebarConfig';
import SupportWidget from './SupportWidget';

/**
 * 側邊欄寬度。
 *
 * 200 是「最長的項目名(四個字 + 圖示)剛好放得下」再留一點呼吸空間 ——
 * 再寬只是留白，而這個系統的主角是右邊那張表：
 * 案件清單有二十幾個欄位，側邊欄每多 40px，表格就少一欄。
 */
const WIDTH = 200;

/**
 * 版面外框。
 *
 * 側邊欄的內容來自後端(已依權限過濾)，前端不維護任何導覽清單 ——
 * 不同站台開的功能不一樣，寫死在前端的話每個站台都要各自維護一份 build。
 */
export default function AppShell({ children }) {
  const { mode, toggle } = useThemeMode();
  const { user, logout } = useUser();
  const { nav, loading } = useSidebarConfig();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const currentTitle = useMemo(() => {
    const mod = nav.find((m) => m.path === location.pathname);
    return mod?.title ?? '';
  }, [nav, location.pathname]);

  const sidebar = (
    <Box sx={{ width: WIDTH, px: 1.2, py: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.8, mb: 2.5 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 2,
            background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 14,
            color: 'primary.contrastText'
          }}
        >
          巡
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.1 }}>道路巡查</Typography>
          <Typography variant="caption" color="text.secondary">
            Demo
          </Typography>
        </Box>
      </Stack>

      <List sx={{ py: 0 }}>
        {loading &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} sx={{ borderRadius: 2, mb: 0.5 }} />)}

        {nav.map((mod) => {
          const active = location.pathname === mod.path;

          return (
            <Box key={mod.id}>
              <ListItemButton
                component={Link}
                to={mod.path ?? '/'}
                selected={active}
                onClick={() => setOpen(false)}
                sx={{
                  borderRadius: 2,
                  mb: 0.3,
                  px: 1.2,
                  py: 0.7,
                  '&.Mui-selected': {
                    // 選中的底色由主色推導：日間的主色較深，用同一組 rgba 會太搶
                    background: (t) =>
                      `linear-gradient(90deg, ${alpha(t.palette.primary.main, 0.16)}, ${alpha(t.palette.primary.main, 0.02)})`,
                    borderLeft: (t) => `2px solid ${t.palette.primary.main}`
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 30, color: active ? 'primary.main' : 'text.secondary', fontSize: 17 }}>{mod.icon}</ListItemIcon>
                <ListItemText primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 600 : 400 }} primary={mod.title} />
              </ListItemButton>

              {/* 展開中的模組列出子功能：讓使用者知道點進去有什麼，而不是點了才發現 */}
              {active && mod.subNav.length > 1 && (
                <Stack sx={{ pl: 4.2, pb: 1 }} spacing={0.2}>
                  {mod.subNav.map((f) => (
                    <Typography key={f.id} variant="caption" color="text.secondary" sx={{ py: 0.2 }}>
                      {f.title}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          // 根元素也要有寬度並禁止收縮：paper 是固定定位的，
          // 只給 paper 寬度的話側邊欄會蓋在內容上面，而且蓋住的區域點不到
          width: WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: WIDTH,
            boxSizing: 'border-box',
            borderRight: (t) => `1px solid ${t.palette.divider}`,
            // 側邊欄自成一層：夜間靠半透明的深色，日間靠一道由白到淡灰藍的漸層。
            // 兩邊都與內容區分得開，但都不是「另一塊純白」
            bgcolor: (t) => (t.palette.mode === 'dark' ? alpha(t.palette.background.paper, 0.6) : t.palette.background.paper),
            backgroundImage: 'var(--sidebar-bg)',
            backdropFilter: 'blur(12px)'
          }
        }}
      >
        {sidebar}
      </Drawer>

      <Drawer open={open} onClose={() => setOpen(false)} sx={{ display: { md: 'none' } }}>
        {sidebar}
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          // color="primary" 會把文字設成 primary.contrastText(白) ——
          // 深色底看起來正常，換到日間就是白字白底
          color="inherit"
          sx={{
            // 半透明 + 模糊：捲動時內容從標題列底下透出來。
            // 顏色取自主題而不是寫死，否則淺色模式的標題列會是一條深色帶
            bgcolor: (t) => alpha(t.palette.background.default, 0.72),
            backdropFilter: 'blur(12px)',
            borderBottom: (t) => `1px solid ${t.palette.divider}`
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            <IconButton sx={{ display: { md: 'none' } }} onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>

            <Typography sx={{ fontWeight: 600, flex: 1 }}>{currentTitle}</Typography>

            <Chip size="small" label={user.roleName} variant="outlined" />
            <Avatar sx={{ width: 30, height: 30, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 13, fontWeight: 700 }}>
              {user.name?.[0] ?? '?'}
            </Avatar>
            <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {user.name}
            </Typography>

            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

            {/* 白天在工地、晚上在辦公室 —— 強光下深色底看不見，深夜盯白底也不合理 */}
            <Tooltip title={mode === 'dark' ? '切換為日間模式' : '切換為夜間模式'}>
              <IconButton onClick={toggle} size="small" aria-label="切換日夜模式">
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            <Tooltip title="登出">
              <IconButton onClick={logout} size="small">
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box sx={{ p: { xs: 2, md: 2.5 } }}>{children}</Box>
      </Box>

      <SupportWidget />
    </Box>
  );
}
