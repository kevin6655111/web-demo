import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// jsdom 沒有 matchMedia；元件用它判斷「使用者是否偏好減少動態效果」
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false,
  media: query,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
}));

// 圖表元件靠容器尺寸決定畫布大小，jsdom 下一律是 0 —— 給它一個固定值
window.ResizeObserver = window.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
