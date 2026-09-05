// 正式環境用：讓編譯後的 dist 也認得 tsconfig 的路徑別名(@/ @entities/ ...)
//
// 別名只在後端自己的程式碼裡；`@road-patrol/shared` 走的是 workspace 的
// node_modules 連結，不需要在這裡登記。
const path = require('path');
const fs = require('fs');
const tsConfigPaths = require('tsconfig-paths');

const raw = fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

tsConfigPaths.register({
  baseUrl: path.join(__dirname, 'dist'),
  paths: config.compilerOptions.paths
});
