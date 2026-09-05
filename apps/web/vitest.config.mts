import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 前端測試設定。
 *
 * 測試策略：判斷邏輯全放在 presenters(純函式)，元件只負責畫。
 * 於是最有價值的測試不需要 DOM、毫秒級跑完；
 * 元件測試只留下「真的只有渲染才驗得到」的那幾件事(無障礙標籤、條件顯示)，
 * 數量少，也就不會因為改個樣式就整片壞掉。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.{js,jsx}'],
    setupFiles: ['./src/__tests__/setup.js'],
    css: false // 不解析 CSS：測試不驗樣式，解析只是拖慢速度
  }
});
