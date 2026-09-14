import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppThemeProvider, useThemeMode } from '../context/ThemeContext';

function Probe() {
  const { mode, toggle } = useThemeMode();

  return (
    <button type="button" onClick={toggle}>
      {mode}
    </button>
  );
}

describe('日夜佈景', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('切換後把選擇存起來，並掛到 <html> 上讓 CSS 跟著換', () => {
    render(
      <AppThemeProvider>
        <Probe />
      </AppThemeProvider>
    );

    const button = screen.getByRole('button');
    const first = button.textContent;

    fireEvent.click(button);

    const next = first === 'dark' ? 'light' : 'dark';
    expect(button.textContent).toBe(next);
    expect(localStorage.getItem('patrol:theme')).toBe(next);

    // CSS 的圖磚濾鏡、捲軸、popup 都認這個屬性
    expect(document.documentElement.dataset.theme).toBe(next);
  });

  it('沒選過時跟著系統偏好走', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    render(
      <AppThemeProvider>
        <Probe />
      </AppThemeProvider>
    );

    expect(screen.getByRole('button').textContent).toBe('light');
    vi.restoreAllMocks();
  });

  it('讀不到 localStorage 也不會讓整個 App 起不來', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('封鎖儲存');
    });

    expect(() =>
      render(
        <AppThemeProvider>
          <Probe />
        </AppThemeProvider>
      )
    ).not.toThrow();

    vi.restoreAllMocks();
  });
});
