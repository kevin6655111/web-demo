# 開發指南

## 專案結構

Yarn workspaces，四個套件：

| 套件                  | 位置              | 是什麼                                                         |
| --------------------- | ----------------- | -------------------------------------------------------------- |
| `@road-patrol/web`    | `apps/web`        | 前端（Vite + React）                                           |
| `@road-patrol/api`    | `apps/api`        | 後端（NestJS，六個行程共用同一份 `src`，進入點在 `src/main/`） |
| `@road-patrol/shared` | `packages/shared` | 前後端共用的領域語彙（代碼表、狀態、中文名）                   |
| `@road-patrol/e2e`    | `e2e`             | Playwright                                                     |

根目錄的 `yarn <script>` 是編排，實際工作在各 workspace 裡；
要單獨對某個套件下指令用 `yarn workspace @road-patrol/api <script>`。

**改到 `packages/shared` 要重建它**（`yarn build:shared`）。`yarn start` 與
`yarn test` 都會先做一次，但開發途中改了共用常數，nodemon 不會替你重建。

## 環境需求

- Node.js 22、Yarn
- Docker Engine + Compose v2

## 第一次跑起來

```bash
# 1. 機密設定(所有密碼都在這裡，不進版控)
cp .env.example .env && vi .env

# 2. 基礎設施(PostGIS / Redis / MinIO)
bash start.sh --infra

# 3. 建表 + 示範資料(可重複執行)
yarn install && yarn seed

# 4. 六個行程一起跑
yarn start
```

開 http://localhost:3005，用 `DEMO` / `admin` / `Demo1234` 登入。

## 分別啟動

```bash
yarn web            # 前端 3005
yarn api            # api 3008
yarn tiles          # 圖層 3010
yarn case-worker    # 案件佇列
yarn report-worker  # 報表佇列
yarn scheduler      # 排程
```

**除 `yarn api` 外都要帶 `RUN_MIGRATIONS=false`** —— 多個行程同時改 schema 會互相鎖死。

背景執行要用 `setsid --fork nohup`，否則行程會跟著 shell 一起被收掉。

## 設定檔的分工

```
.env                     所有機密(帳密、金鑰)，開發與部署共用同一份，永不進版控
config/config.dev.yaml   開發用：連哪台主機、排程開關
config/config.prod.yaml  部署用：每個站台一份
```

yaml 裡的機密欄位一律寫成 `${VAR}`，啟動時展開。
**缺任何一個變數，後端會列出「缺哪個、對應哪個設定路徑」然後中止** —— 不讓服務帶著空密碼跑起來。

展開後的變數會從 `process.env` 移除，避免機密被子行程或錯誤堆疊帶出去。

## 新增一支 API

1. DTO：`*.dto.ts`，每個欄位加 `@ApiProperty` 與驗證裝飾器
2. Service：商業邏輯，回傳 `HttpResponse.success/warn/successOrWarn`
3. Controller：
   - `@ApiOperation({ summary, description })` — 說明裡要寫「所需權限：`XXX.YYY`」
   - `@ApiBody({ examples })` — 至少兩個範例
   - `@ApiResponse` + `@ApiCommonErrors()`
   - `@RequireAction(ACTION.X.Y)` — 權限字串一律取自常數
   - 同一支端點在不同欄位值下重量不同時，加 `@RequireActionByField('STATUS', { ... })`：
     刪除、撤回、驗收都比一般更新重，但它們的請求主體一模一樣，
     拆成四支端點只會讓前端記四個路徑
   - `@Audit({ action, keys })` — `keys` 是白名單，不要把整包 body 寫進日誌
   - 會被重送的寫入端點加 `@Idempotent()`

沒有 `summary` 的端點不會出現在文件（`keepDocumented` 是 opt-in）。

## 新增資料表

```bash
yarn migrate:create <MigrationName>   # 產在 server/src/migrations/<年份>/
```

- 手寫 SQL，不要用自動產生的差異
- 加欄位到已有資料的表時**要回填**，否則歷史資料會斷在導入那天
- 一定要寫 `down()`；有損的 `down()` 要在註解裡說清楚損在哪
- **新實體要加進 `database.module.ts` 的 `ALL_ENTITIES`**
- **不可修改已經執行過的 migration**
- 「同一群組內不重號」這種條件用**部分唯一索引**（`WHERE ... IS NOT NULL`），
  否則所有沒有編號的列會互相撞

## 硬規則

**後端**

- SQL 一律參數化；排序欄位用白名單映射，不要把使用者輸入拼進 `orderBy`
- 分頁查詢的 `orderBy` 要用**實體屬性名**(`c.detectedAt`)而非欄位名(`c.detected_at`)
- 每個查詢都要有 `company_id` 條件 —— 漏掉就是跨公司資料外洩
- 全域守衛要排除非 HTTP 情境(`context.getType() !== 'http'`)，否則微服務事件會被安靜擋掉
- BullMQ 的 `jobId` **不可含冒號**
- **批次端點不要在迴圈裡逐筆做事**：50 筆的批次若逐筆寫歷程，就是 50 個交易、
  350 趟往返。用 `recordMany` 之類的批次 API，一次撈完、一次寫完
- **篩選要在 SQL 裡做**：分頁之後才用 JS 過濾的話，`TOTAL` 是篩選前的數字，
  而一頁 50 筆會回傳不到 50 筆
- 新增代碼表放 `packages/shared`，不要放在後端的模組裡
- 跨模組用別人的 service 時，模組要 `imports` 對方的 module ——
  只在 `forFeature` 列了對方的 entity，Nest 會在啟動時丟 `can't resolve dependencies`
- 單號流水用 **`MAX(流水) + 1`** 而不是「筆數 + 1」；序號有缺口時筆數會撞號，
  併發時再由唯一鍵衝突的重試接住
- **任何改動狀態的路徑都要寫歷程**，包含改別人的狀態 ——
  復原功能靠歷程決定要回到哪一步，漏一次就少一段

**前端**

- 判斷邏輯放 `presenters/`，元件只渲染
- API 走 `models/api/patrolApi.js`，不要在元件裡拼路徑
- 顏色與中文標籤取自 `config/vocabulary.js`（由 `@road-patrol/shared` 推導），
  不要手寫任何一份對照表 —— 前後端各存一份必定分岔，而且已經分岔過三次
- 查詢面板新增欄位時，後端 DTO 要同步並實作查詢條件。
  DTO 缺欄位 → 整個請求 400；DTO 有但服務沒實作 → 條件被安靜忽略
- 導覽與按鈕依 `can('X.Y')` 顯示：可見但無權操作的元件，是最不利於使用者的介面設計
- 大型套件用 `lazy()` 延後載入，維持 `vite.config.mts` 的 `manualChunks` 分包

## 常用指令

```bash
yarn typecheck                              # 前後端型別
yarn test                                   # 前端測試
yarn test:api                               # 後端測試
yarn test:e2e                               # Playwright
yarn build                                  # 前後端建置
yarn seed                                   # 重灌示範資料
SEED_SCALE=3 yarn seed                      # 放大三倍(壓測用)
```

一次跑完所有檢查：

```bash
bash .claude/skills/patrol-dev/scripts/check.sh
```
