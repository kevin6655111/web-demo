// 正式環境用：讓編譯後的 dist 也認得 tsconfig 的路徑別名(@/ @entities/ ...)
//
// 別名只在後端自己的程式碼裡；`@road-patrol/shared` 走的是 workspace 的
// node_modules 連結，不需要在這裡登記。
const path = require('path');
const fs = require('fs');
const tsConfigPaths = require('tsconfig-paths');

const raw = fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

// tsconfig 的 paths 以自己所在目錄為基準指向 ./src(TypeScript 7 起不能再靠 baseUrl)，
// 執行的卻是編譯產物。dist 與 src 的目錄結構一致，換掉前綴就對得上；
// 兩邊共用同一份定義，才不會加了別名卻忘記同步而在正式環境才炸。
const paths = Object.fromEntries(
  Object.entries(config.compilerOptions.paths).map(([alias, targets]) => [
    alias,
    targets.map((target) => target.replace(/^\.\/src\//, './dist/'))
  ])
);

tsConfigPaths.register({ baseUrl: __dirname, paths });
