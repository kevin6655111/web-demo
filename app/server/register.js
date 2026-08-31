// 正式環境用：讓編譯後的 dist 也認得 tsconfig 的路徑別名(@/ @entities/ ...)
const path = require('path');
const fs = require('fs');
const tsConfigPaths = require('tsconfig-paths');

const raw = fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

tsConfigPaths.register({
  baseUrl: path.join(__dirname, '../dist/server/src'),
  paths: config.compilerOptions.paths
});
