import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * 後端測試設定。
 *
 * 路徑別名直接讀 tsconfig.json，不在這裡重寫一份 ——
 * 別名有多個候選目錄(@entities 同時指向 auth 與 case-patrol)，
 * 手寫 alias 會漏掉其中一邊，而且和編譯設定不同步時很難查。
 *
 * 副檔名是 .mts：vite-tsconfig-paths 是 ESM-only，而這個 workspace 是 CommonJS，
 * 用 .ts 會被當成 CJS 載入而失敗。
 */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(import.meta.dirname, 'tsconfig.json')] })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks' // TypeORM 與 ioredis 的連線不適合在 worker thread 間共用
  }
});
