import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import KpiCard from '../views/components/KpiCard';
import { theme } from '../styles/theme';

const renderCard = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <KpiCard label="今日新增" value={42} unit="件" tone="info" {...props} />
    </ThemeProvider>
  );

/**
 * 元件測試只驗「渲染才看得到」的行為：
 * 數字滾動最終要停在正確的值、偏好減少動態時要直接顯示。
 * 樣式與版面不測 —— 那種測試每次改設計都會壞，卻抓不到真正的問題。
 */
describe('KpiCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('滾動結束後顯示目標數字', async () => {
    renderCard();

    // requestAnimationFrame 在 jsdom 由計時器驅動，快轉到動畫結束
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('件')).toBeInTheDocument();
    expect(screen.getByText('今日新增')).toBeInTheDocument();
  });

  it('使用者偏好減少動態效果時，直接顯示結果不做動畫', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });

    renderCard({ value: 99 });
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('數值為 0 時顯示 0 而不是空白', async () => {
    renderCard({ value: 0 });

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
