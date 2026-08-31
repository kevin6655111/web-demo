import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 前端建置。
 *
 * 開發時把 /api 與 /ws 代理到後端，讓前端永遠用同源路徑 ——
 * 這樣 cookie 帶得出去，程式碼裡也不必為開發與部署各寫一套網址。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    sourcemap: false, // 正式環境不出 source map：那等於把原始碼一起部署上去
    rollupOptions: {
      output: {
        /**
         * 把大型第三方套件切成獨立 chunk。
         *
         * 全部打成一包的話，改一行程式就會讓使用者重新下載 1MB；
         * 切開之後 vendor 的快取可以跨版本沿用，而地圖與圖表
         * 只有真的開到那些頁面才會下載。
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          charts: ['recharts'],
          map: ['leaflet', 'react-leaflet']
        }
      }
    }
  },
  server: {
    port: 3005,
    proxy: {
      '/api/tiles': { target: 'http://localhost:3010', changeOrigin: true }, // 圖層是獨立行程
      '/api': { target: 'http://localhost:3008', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3008', ws: true }
    }
  }
});
