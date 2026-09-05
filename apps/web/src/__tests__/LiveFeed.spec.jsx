import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import LiveFeed from '../views/components/LiveFeed';
import { theme } from '../styles/theme';

const renderFeed = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <LiveFeed rows={[]} connected {...props} />
    </ThemeProvider>
  );

describe('LiveFeed', () => {
  it('沒有資料時顯示提示，而不是一片空白', () => {
    renderFeed();
    expect(screen.getByText('尚無案件')).toBeInTheDocument();
  });

  it('連線狀態如實顯示', () => {
    const { rerender } = renderFeed({ connected: true });
    expect(screen.getByText('已連線')).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <LiveFeed rows={[]} connected={false} />
      </ThemeProvider>
    );
    expect(screen.getByText('連線中…')).toBeInTheDocument();
  });

  it('尚未定位的案件顯示「定位中」而不是空白路名', () => {
    renderFeed({
      rows: [{ ID: 1, CASE_NUM: 'DEMO01000001', CRACK_TYPE: 'Potholes', STATUS: 0, NEED_REPAIR: 0, ROAD_NAME: null, DT_RECORD: '2026-08-28T10:00:00Z' }]
    });

    expect(screen.getByText(/坑洞 · 定位中…/)).toBeInTheDocument();
    expect(screen.getByText('DEMO01000001')).toBeInTheDocument();
  });
});
