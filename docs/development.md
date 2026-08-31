# 開發指南

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
cd app && yarn install && yarn seed

# 4. 六個行程一起跑
yarn start
```

開 http://localhost:3005，用 `DEMO` / `admin` / `Demo1234` 登入。

## 分別啟動

```bash
yarn web            # 前端 3005
yarn server         # api 3008
yarn tiles          # 圖層 3010
yarn worker         # 案件佇列
yarn report-worker  # 報表佇列
yarn scheduler      # 排程
```

**除 `yarn server` 外都要帶 `RUN_MIGRATIONS=false`** —— 多個行程同時改 schema 會互相鎖死。

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
   - `@Audit({ action, keys })` — `keys` 是白名單，不要把整包 body 寫進日誌
   - 會被重送的寫入端點加 `@Idempotent()`

沒有 `summary` 的端點不會出現在文件（`keepDocumented` 是 opt-in）。

## 新增資料表

```bash
yarn migrate:create <MigrationName>   # 產在 server/src/migrations/<年份>/
```

- 手寫 SQL，不要用自動產生的差異
- 加欄位到已有資料的表時**要回填**，否則歷史資料會斷在導入那天
- 一定要寫 `down()`
- **新實體要加進 `database.module.ts` 的 `ALL_ENTITIES`**
- **不可修改已經執行過的 migration**

## 硬規則

**後端**

- SQL 一律參數化；排序欄位用白名單映射，不要把使用者輸入拼進 `orderBy`
- 分頁查詢的 `orderBy` 要用**實體屬性名**(`c.detectedAt`)而非欄位名(`c.detected_at`)
- 每個查詢都要有 `company_id` 條件 —— 漏掉就是跨公司資料外洩
- 全域守衛要排除非 HTTP 情境(`context.getType() !== 'http'`)，否則微服務事件會被安靜擋掉
- BullMQ 的 `jobId` **不可含冒號**

**前端**

- 判斷邏輯放 `presenters/`，元件只渲染
- API 走 `models/api/patrolApi.js`，不要在元件裡拼路徑
- 顏色與中文標籤取自 `styles/theme.js`，不要各處硬寫
- 導覽與按鈕依 `can('X.Y')` 顯示 —— 看得到卻按了就 403 是最糟的介面
- 大型套件用 `lazy()` 延後載入，維持 `vite.config.mts` 的 `manualChunks` 分包

## 常用指令

```bash
npx tsc -p server/tsconfig.json --noEmit   # 後端型別
yarn test                                   # 前端測試
yarn test:e2e                               # 後端測試
yarn test:e2e:browser                       # Playwright
npx vite build                              # 前端建置
yarn seed                                   # 重灌示範資料
SEED_SCALE=3 yarn seed                      # 放大三倍(壓測用)
```

一次跑完所有檢查：

```bash
bash .claude/skills/patrol-dev/scripts/check.sh
```
