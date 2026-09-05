/* eslint-disable no-console */
/**
 * 後端產出物的原始碼保護。
 *
 * `tsc` 吐出來的 `apps/api/dist` 是可讀的 JavaScript —— 離線交付時整包會落在
 * 對方的機器上，等於把商業邏輯、查詢條件與資料表結構一起交出去。
 * 這一步把它換成等價但難讀的形式。
 *
 * **這不是加密，是提高抄襲成本**。任何在對方機器上執行的程式，
 * 對方終究拿得到它的行為；真正不能外流的東西不該放在交付的映像檔裡。
 *
 * 三個刻意的取捨：
 *
 * 1. **不改識別字以外的東西**（不開 controlFlowFlattening / deadCodeInjection）。
 *    那兩項會讓程式碼膨脹三到五倍、啟動變慢，而 NestJS 在啟動時要跑完整個
 *    DI 圖 —— 慢的是每一次重啟，換來的只是多繞幾層的閱讀難度。
 * 2. **保留類別名稱**。NestJS 的依賴注入靠 `design:paramtypes` 的類別參考，
 *    改名不會壞；但例外堆疊、`@nestjs/swagger` 的 schema 名稱、
 *    TypeORM 的實體名稱都會跟著變成亂碼，出事時沒有人查得下去。
 * 3. **刪掉 source map**。留著等於把原始碼原封不動附在旁邊。
 *
 * 用法：`yarn build:api:prod`（它會先重建 shared，見下）
 * 或設 `PROTECT_SOURCE=false` 跳過（開發與 CI 的除錯建置）。
 *
 * **這一步會刪掉 `packages/shared/dist` 的 `.d.ts`**，所以跑完之後
 * 下一次 `tsc` 會找不到共用套件的型別 —— `build:api:prod` 因此
 * 自己先 `build:shared` 一次。手動跑 `node scripts/protect.js` 之後，
 * 編輯器要等下一次 `yarn build:shared` 才恢復。
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

/**
 * 要保護的產出。
 *
 * 共用套件也在內：領域語彙搬進 `packages/shared` 之後，
 * 資料表結構、狀態機、代碼表全都在那裡 —— 只混淆 `apps/api`
 * 等於把最值錢的那一份原封不動附在旁邊。
 *
 * 只處理 CJS 那一份：ESM 是給前端打包用的，而前端的產出由 Vite 自己壓過，
 * 也不會進到後端映像檔裡。
 */
const TARGETS = [
  path.resolve(__dirname, '..', 'apps', 'api', 'dist'),
  path.resolve(__dirname, '..', 'packages', 'shared', 'dist', 'cjs')
];

/**
 * 混淆選項。
 *
 * `identifierNamesGenerator: 'mangled'` 產生 a/b/c 這種短名，
 * 比 hexadecimal 小很多 —— 檔案大小直接影響冷啟動的讀取時間。
 *
 * `reservedNames` 保住類別名：見上面第 2 點。
 */
const OPTIONS = {
  compact: true,
  identifierNamesGenerator: 'mangled',
  renameGlobals: false,
  // 類別名稱(大寫開頭)一律不改：DI、Swagger schema、TypeORM 實體名都靠它
  reservedNames: ['^[A-Z][A-Za-z0-9_]*$'],
  // 字串搬進陣列並做一層編碼：資料表名、SQL 片段、權限字串不再是 grep 得到的明碼
  stringArray: true,
  stringArrayEncoding: ['base64'],
  // 1.0 而不是預設的 0.75：留在原地的那 15% 字串就是資料表名、狀態中文與權限字串，
  // 而那些正是 grep 一下就看得到的東西 —— 保護做了八成等於沒做
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 12,
  numbersToExpressions: true,
  simplify: true,
  // 這三項膨脹最兇、啟動最慢，換來的閱讀難度有限
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  sourceMap: false,
  target: 'node'
};

/** 遞迴收集要處理的檔案 */
function collect(dir, out = { js: [], maps: [], dts: [] }) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.d.ts')) out.dts.push(full);
    else if (entry.name.endsWith('.js')) out.js.push(full);
    else if (entry.name.endsWith('.js.map')) out.maps.push(full);
  }

  return out;
}

function main() {
  if (process.env.PROTECT_SOURCE === 'false') {
    console.log('⏭️  PROTECT_SOURCE=false，跳過原始碼保護');
    return;
  }

  const missing = TARGETS.filter((dir) => !fs.existsSync(dir));
  if (missing.length) {
    console.error(`❌ 找不到 ${missing.join('、')}，請先執行 yarn build:api`);
    process.exit(1);
  }

  const js = [];
  const maps = [];
  for (const dir of TARGETS) {
    const found = collect(dir);
    js.push(...found.js);
    maps.push(...found.maps);
  }

  let before = 0;
  let after = 0;

  for (const file of js) {
    const source = fs.readFileSync(file, 'utf8');
    before += source.length;

    const result = JavaScriptObfuscator.obfuscate(source, OPTIONS).getObfuscatedCode();
    after += result.length;

    fs.writeFileSync(file, result);
  }

  // source map 留著等於把原始碼原封不動附在旁邊；
  // 型別宣告(.d.ts)同理 —— 它把每個常數的字面值都寫得清清楚楚
  for (const map of maps) fs.unlinkSync(map);

  for (const dir of TARGETS) {
    for (const dts of collect(dir).dts) fs.unlinkSync(dts);
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`🔒 已保護 ${js.length} 個檔案：${mb(before)}MB → ${mb(after)}MB，移除 ${maps.length} 個 source map`);
}

main();
