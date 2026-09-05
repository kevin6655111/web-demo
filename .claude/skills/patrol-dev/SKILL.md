---
name: patrol-dev
description: 開發道路巡查 Demo（NestJS 微服務 + PostGIS + BullMQ + WebSocket + React）。當使用者要新增或修改 API、資料表、排程、佇列、報表、巡查單、派工單、權限、圖層、即時通訊、儀表板，或要求跑起來、測試、打包、部署、除錯此專案時使用。關鍵字：加 API、改資料表、新增排程、報表、巡查、派工、權限、WebSocket、遷移、migration、seed、跑起來、打包、離線包、CI、部署。
---

# 道路巡查 Demo 開發流程

多行程的 NestJS 後端 + React 前端，以 Docker Compose 部署。

## 系統地圖

六個行程，各自一個容器。**分開的理由是「壞的方式不同」**，動手前先確認要改的東西屬於哪一個：

| 行程 | 進入點 | 職責 | 為什麼獨立 |
|---|---|---|---|
| `api` | `server/server.ts` | 對外 API、WebSocket、微服務事件訂閱 | 使用者等在螢幕前，要快 |
| `tiles` | `server/tiles.ts` | 圖層(GeoJSON + Redis 快取) | 一次吐幾 MB，會佔住 event loop |
| `worker` | `server/worker.ts` | 案件佇列(逆地理編碼) | 會逾時、要重試 |
| `report-worker` | `server/report-worker.ts` | 報表佇列(Excel/Word) | 一份報表吃幾百 MB |
| `scheduler` | `server/scheduler.ts` | 11 支排程 + 手動觸發事件訂閱 | 只能有一份在跑 |
| `nginx` | — | 靜態檔、反向代理、TLS | — |

**只有 `api` 跑 migration**（其餘行程的 compose 設 `RUN_MIGRATIONS=false`）。多個行程同時改 schema 會互相鎖死。

---

## 領域模組

### 目錄結構

Yarn workspaces，四個套件：

```
apps/web/          前端 (@road-patrol/web)     Vite + React
apps/api/          後端 (@road-patrol/api)     NestJS，六個行程共用同一份 src
  src/main/        六個進入點：api / tiles / worker / report-worker / scheduler
  src/<領域>/      領域模組
packages/shared/   共用語彙 (@road-patrol/shared)
e2e/               Playwright (@road-patrol/e2e)
scripts/           打包、混淆、離線安裝
config/ nginx/ monitoring/
```

**`packages/shared` 放的是「這個系統的世界裡有哪些東西」** —— 破壞類型、單據狀態、
施工材料、照片分區。它們同時是後端的驗證清單與前端的下拉選項與中文標籤。

前後端各存一份的下場已經發生過三次：材料 `COLD` 後端寫「冷拌瀝青」前端寫「冷瀝青」、
前端多出一個後端沒有的 `OTHER`、標案狀態少了 `SUSPENDED`（暫停中的標案顯示成空白）。
**前端不再手寫任何一份對照表**，`apps/web/src/config/vocabulary.js` 全部由定義推導。

shared **刻意沒有執行期依賴**：後端在 CommonJS 裡用它、前端在 ESM 裡用它，
多一個依賴就要同時滿足兩邊。它同時輸出 CJS 與 ESM（Rollup 看不穿 CJS 的
`export *`，只給 CJS 的話前端建置會找不到具名匯出）。

分成 workspace 而不是單一 package，是因為依賴真的不同：
後端映像檔過去會裝進 MUI、Leaflet、Recharts 這些它一個都用不到的東西。

模組位置：`apps/api/src/<領域>/`，各含 `*.module.ts` `*.controller.ts` `*.service.ts` `*.dto.ts` `*.example.ts` `entities/`。

### 單據流程（這套系統的主線）

四種單據，**都是分表設計**（主表 / 狀態 / 附屬 / 照片），因為欄位的「誰在寫、什麼時候寫」不同：

| 模組 | 單據 | 表 | 狀態 |
|---|---|---|---|
| `case-patrol` | AI 車巡案件 | `patrol_cases` + `_addresses` + `_statuses` | 三組狀態（見下） |
| `maintenance` | 巡查單 RA／巡修單 RB | `maintenances` + `_statuses` + `_repairs` + `_images` | -1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工 |
| `work-order` | 派工單 PA/PB/PC/PD | `work_orders` + `_statuses` + `_users` + `_improvements` + `_images` | -1 已刪除 / 0 待處理 / 1 施工中 / 2 已回報 / 3 已完工 |
| `survey` | 鋪面檢測 | `survey_orders` + `survey_cases` | -1 / 0 未檢查 / 1 已檢查 |

**流程是「先發現、再派工」**：

```
AI 車巡案件 ──┐
              ├─→ 派工單 ──→ 施工 ──→ 回報 ──→ 驗收完工
巡查單(RA/RB)─┘   PC 來自車巡案件、PD 來自巡查單
```

四種派工單類型的差別在**來源與必填欄位**（`WORK_ORDER_TYPE_DEF`）：

- `PA` 刨除加封、`PB` 路基改善 —— 自行發起的工程；PB 另外必填取樣資訊
- `PC` AI 車巡 —— 必須帶 `CASE_PATROL_ID`
- `PD` APP 巡查 —— 必須帶 `MAINTENANCE_ID`

巡查單兩種類型（`MAINTENANCE_TYPE_DEF`）：

- `RA` 巡查 —— 只記錄「看到什麼」
- `RB` 巡修 —— **當場修掉了**，必填材料，另存一列回填內容；改回 RA 時那一列會被刪掉

### 其餘模組

`auth`(登入/權限/組織三層) `orgstruct`(導覽定義) `core`(代碼表/公告/驗證碼)
`project`(標案與關聯) `case-history`(五種實體共用的版本化歷程)
`fleet`(車隊/軌跡) `road-eval`(道路評估) `patrol-setting`(巡查計畫與覆蓋率)
`report`(報表佇列) `dashboard` `tiles`(向量/GeoJSON 圖層) `geo`(逆地理編碼)
`websocket`(推播) `support`(客服) `task`(排程) `queue`(BullMQ + 事件匯流排)
`storage`(MinIO) `security`

---

## 三段業務規則（改動寫入路徑前務必讀完）

這三段是這套系統最容易改壞、也最難從測試看出來的地方。

### 1. 狀態不是直接寫入的，動作碼要先看當前狀態

派工單與巡查單的狀態端點都收 **動作碼**（`WORK_ORDER_ACTION`）：

| 送進來 | 實際寫入 | 規則 |
|---|---|---|
| `9` 撤回 | 退一階 | 退到待處理／施工中這一段時，改由**有沒有施工人員**決定 |
| `8` 復原 | 歷程上一個不同的狀態 | 不能低於 workerStatus |
| `-1` 刪除 | -1 | **已回報／已完工不允許**，要先撤回 |

實作在 `work-order.service.ts` 的 `resolveStatus` / `resolveRestore`，
與 `maintenance.service.ts` 的 `restore`。

**「有人員是施工中、沒人員是待處理」是不變量**：一張沒有人卻標成施工中的單，
在看板上會被當成有人在做，而現場沒有人去。

### 2. 復原靠歷程，所以每一次狀態變動都要留歷程

`caseHistoryService.getPreviousDifferentValue()` 是復原的唯一依據。
**只要有任何路徑改了狀態卻沒寫歷程，復原就會跳過那一段。**

最容易漏的是「別的模組改了我的狀態」：開派工單會把巡查單轉成已派工、
刪派工單會把它退回觀察中 —— 這兩處都必須呼叫
`maintenanceService.recordStatusHistory()`（`work-order.service.ts` 裡有）。

### 3. 刪除的守門條件

- 巡查單：**有活著的派工單就不可刪**。派工單一律由使用者自己處理，不做連帶刪除 ——
  刪一張巡查單順手把別人正在施工的派工單也刪掉，是沒有人預期得到的事。
- 批次操作**不整批失敗**：不能改的那幾筆跳過並附上原因（`BatchResult.skipped`），
  訊息以 `\n` 分行，前端用 `white-space: pre-line` 呈現。
  整批失敗的話，使用者要自己猜是哪一筆卡住，再把其餘的送一次。

---

## 冪等三層（改動寫入路徑時務必維持）

1. HTTP `Idempotency-Key` → Redis `SET NX`，回放第一次的回應
2. BullMQ `jobId`（**不可含冒號**，BullMQ 內部用它切 key）
3. 資料庫唯一鍵 `(dt_record, img_detect, crack_id)`、`external_id`、`case_num`

Redis 會被清空、視窗會過期，**第三層是唯一不會消失的保證**，不要拿掉。

---

## 微服務與即時推播

事件走 **Redis transport**（`@nestjs/microservices`），佇列走 BullMQ。**兩者不要混用**：

| | 用途 | 沒有消費者時 |
|---|---|---|
| 佇列 BullMQ | 要重試、要保證做完的「工作」 | 堆著等人做 |
| 事件 Redis transport | 廣播「發生了什麼」 | 丟掉就好 |

用佇列送通知的話，沒人消費的通知會一直堆在 Redis 裡直到把記憶體吃光。

事件名稱在 `queue/queue.const.ts` 的 `EVENT`；送出一律走
`queue/case-event.publisher.ts`（`workOrderChanged` / `maintenanceChanged`），
訂閱在 `websocket/case-events.controller.ts`。

新增一種推播要動三個地方：`EVENT` 常數 + 事件型別、publisher 的方法、
`case-events.controller` 的 `@EventPattern`，以及 `websocket/ws.type.ts` 的 `WS_CHANNEL`
（頻道名沒加進去，`broadcast` 的型別就過不了）。

**全域守衛與攔截器要排除非 HTTP 情境**（`context.getType() !== 'http'`）——
微服務事件會繼承它們，沒排除的話每個事件都被安靜擋掉，WebSocket 推播從此不再送出。

---

## 階段一：確認要改哪一層（此階段不寫任何檔案）

1. 讀相關模組，找出**實際的插入點與既有命名**，不要憑印象。
2. 判斷這次的改動落在哪一層，照下表決定作法：

   | 要做的事 | 放哪裡 | 不要放哪裡 |
   |---|---|---|
   | 使用者等得住的查詢/寫入 | `api` 的 controller + service | 不要塞進 worker |
   | 慢、會失敗、要重試 | BullMQ 佇列 + processor | 不要在 API 裡同步做 |
   | 「發生了什麼」的廣播 | `CaseEventPublisher` | 不要用佇列送通知 |
   | 定時要做的事 | `task-definitions.ts` + `task.service.ts` | 不要用 setInterval |
   | 依請求內容而不同的權限 | `@RequireActionByField` | 不要拆成四支端點 |
   | 前端的判斷/換算/配色 | `presenters/` | 不要寫在元件裡 |
   | 新的地圖圖層 | 面板登錄 + `MapCanvas` 畫法 | 不要另開一張地圖 |
   | 前端下拉選單的選項 | 後端 `core/code` 代碼表 | 不要在前端寫死中文對照 |

3. 動到資料表就要寫 migration（見下節），**不可改既有的 migration 檔**。
4. 跑基準檢查，記下**修改前就存在**的問題：

   ```bash
   bash .claude/skills/patrol-dev/scripts/check.sh
   ```

5. 向使用者說明要動哪些檔案、各做什麼。

---

## 階段二：執行

### 後端硬規則

- **每支 API 都要有文件**：`@ApiOperation({ summary, description })` + `@ApiBody` 範例 + `@ApiResponse` + `@ApiCommonErrors()`。
  說明裡要寫「所需權限：`XXX.YYY`」。沒有 `summary` 的端點不會出現在文件（`keepDocumented` 是 opt-in）。
- **回應一律用 `HttpResponse`** 的 success / warn / successOrWarn / error，不要自己拼 JSON。
  批次端點用 `successOrWarn` + `isEmpty: () => skipped.length > 0`：有跳過就回 warn，訊息一樣但前端會換顏色。
- **權限用 `@RequireAction(ACTION.X.Y)`**，權限字串一律取自 `@constants/module.const`，不要寫字面字串。
  同一支端點在不同欄位值下重量不同時，加 `@RequireActionByField('STATUS', { ... })` ——
  刪除、撤回、復原、驗收都比一般更新重，但它們的請求主體一模一樣。
- **會被重送的寫入端點要加 `@Idempotent()`**（車機、對接系統、任何有自動重試的上游）。
- **稽核用 `@Audit({ action, keys })`**，`keys` 是白名單 —— 不要把整包 body 寫進日誌。
- **SQL 一律參數化**；`orderBy` 搭配 `skip/take` 時要用**實體屬性名**（`c.detectedAt`）而非欄位名（`c.detected_at`），否則分頁查詢會炸。
- **多租戶**：每個查詢都要有 `company_id` 條件。漏掉就是資料外洩。
- 新增實體要加進 `database.module.ts` 的 `ALL_ENTITIES`（不是 `autoLoadEntities`）。
- 跨模組用別人的 service 時，模組要 `imports` 對方的 module ——
  只在 `forFeature` 列了對方的 entity 是不夠的，Nest 會在啟動時丟
  `Nest can't resolve dependencies`。
- **批次端點不要在迴圈裡逐筆做事**：50 筆的批次若逐筆寫歷程，就是 50 個交易、
  350 趟往返。快照用一次 `IN` 撈完、版本號用一次 `GROUP BY` 算完、
  歷程用一次 INSERT 寫完（`caseHistoryService.recordMany`）。
- **篩選要在 SQL 裡做，不要取回來再用 JS 過濾**：分頁之後才過濾的話，
  `TOTAL` 是篩選前的數字，而一頁 50 筆會回傳不到 50 筆 ——
  使用者看到「共 433 筆」卻怎麼翻都翻不完。
- **代碼表一律放 `@road-patrol/shared`**，前端不手寫中文對照。
  它同時是後端的驗證清單與前端的下拉選項，各存一份必定分岔。
- PostGIS 的 `ST_AsMVTGeom` 要先 `ST_Transform` 到 3857；不轉不會報錯，只回空圖磚。

### 前端硬規則

- 判斷邏輯放 `presenters/`，元件只渲染。顏色、門檻、單位換算都是判斷。
- API 一律走 `models/api/patrolApi.js`，不要在元件裡拼路徑。
  動作碼（撤回 9、復原 8、刪除 -1）包成具名方法（`workOrderApi.withdraw`…），畫面不必記得數字。
- 狀態顏色與中文標籤取自 `config/vocabulary.js`（`CASE_STATUS_LABEL` / `NEED_REPAIR_LABEL`
  / `WORK_ORDER_LABEL` / `MAINTENANCE_LABEL` / `WORK_UNIT_LABEL` / `MATERIAL_LABEL` …）。
  那個檔案**全部由 `@road-patrol/shared` 推導**，不要在裡面手寫任何一份對照表。
  破壞類型的 key 沿用判讀模型的輸出（`Potholes`、`Alligator_Cracking`…，大小寫照抄）。
- **中文標籤與狀態色取自 `config/vocabulary.js`**（由 shared 推導），不是 `styles/theme.js`。
  theme 只有 MUI 的 createTheme —— 放在一起會讓人以為「換佈景就能改狀態名稱」。
- 顏色一律用主題語彙（`divider` / `background.paper` / `action.hover` / `primary.contrastText`），
  不要硬寫 `#0b1220` 這類深色值 —— 日間模式會變成黑塊。
- **狀態色走 CSS 變數**（`var(--c-success)` 等，定義在 `styles/global.css` 依 `data-theme` 切換）。
  深底用的粉彩色放到白底上對比只有 2:1，兩種佈景各需要一組。
  要對顏色做透明度運算時例外 —— `var()` 算不動，改從 `useTheme()` 取真實色值。
- Recharts 的 `contentStyle`、`stroke`、`stopColor` 是原生 SVG/CSS，不吃 sx 也不吃 `var()`
  （圖例的色塊會算不出來），一律從 `useTheme()` 取值。
- 選單超過 8 個選項會自己長出搜尋欄（`components/form/SearchableSelect`）；
  自訂選單時沿用它，不要再寫一個 `<Select>`。
- 查詢條件定義集中在 `config/queryFields.js` —— 同一組案件條件同時出現在案件列表與地圖的破壞查詢面板，
  兩邊各寫一份的話，地圖查得到的案件在列表查不到。
- 導覽與按鈕依 `can('X.Y')` 顯示 —— 看得到卻按了就 403 是最糟的介面。
- 大型套件（地圖、圖表）用 `lazy()` 延後載入，並維持 `vite.config.mts` 的 `manualChunks` 分包。

### 前端結構

`apps/web/src/` —— `views/`(畫面) `presenters/`(判斷邏輯) `models/api/`(呼叫層) `hooks/` `context/` `config/`

畫面：`DashboardView` `MapView` `CaseView` `OrderModView`(巡查單／派工單兩個分頁)
`ReportView` `ManageView`。

對話框：`views/components/dialog/` —— `FormDialog`(外框) `ConfirmDialog`
`CaseDetailDialog`(案件詳情，含派工與討論分頁、上下筆翻頁) `CaseEditDialog`
`MaintenanceDialog`(巡查單，RB 才有回填區) `DispatchDialog`(由案件或巡查單派工)
`WorkOrderDialog`(回報、驗收、撤回、復原、刪除) `ProjectDialog` `UserDialog`
`RoleDialog`(權限矩陣) `VehicleDialog` `PlanDialog` `SurveyDialog` `AnnouncementDialog` `CaseChatPanel`。

**圖台是單一地圖 + 圖層登錄表**（`context/MapContext.jsx`）：
各面板把圖層登錄進來，所以破壞、軌跡、路段、計畫可以疊看。
新增一種圖層要動三個地方：面板(登錄)、`MapCanvas`(畫法)、`LayerControlPanel`(分組)。

### migration

```bash
yarn migrate:create <MigrationName>            # 產在 apps/api/src/migrations/<年份>/
yarn seed                                      # 資料(可重複執行)
yarn seed:images                               # 示範圖片(SVG，上傳到 MinIO)
```

- 手寫 SQL，不要用自動產生的差異。
- 加欄位到已有資料的表時，**要回填**（例如把 `worker_user_id` 搬進關聯表），
  否則歷史資料會斷在導入那天。
- 一定要寫 `down()`。有損的 down 要在註解裡說清楚損在哪（例如多人只留一人）。
- **事後補約束前要先讓既有資料合法**：直接 `ADD CONSTRAINT` 會被自己的舊資料擋下。
- 「同一標案內不重號」這種條件用**部分唯一索引**（`WHERE ... IS NOT NULL`），
  否則所有沒有編號的列會互相撞。

---

## 階段三：驗證（必跑，且必須貼出實際輸出）

```bash
yarn typecheck    # 前後端型別（會先建 shared）
yarn test         # 前端測試
yarn test:api     # 後端測試
yarn test:e2e     # Playwright(需服務先跑起來)
yarn build        # 前後端建置
```

單一 workspace 的指令用 `yarn workspace @road-patrol/api <script>`。

或一次跑完靜態規則、隱私掃描、型別、測試與建置：

```bash
bash .claude/skills/patrol-dev/scripts/check.sh
```

動到 API 或資料流時，還要實際跑一遍（服務啟動方式見下節），並貼出 curl 的實際回應。

通過標準：

1. 型別檢查零錯誤，測試全綠。
2. 新增或修改 API 時，`http://localhost:3008/api-docs` 看得到該端點且說明完整。
3. 動到寫入路徑時，**實測重送一次**，確認不會產生第二筆資料。
4. 動到狀態流程時，**實測走完一輪**：建立 → 派工 → 撤回 → 刪除 → 復原，
   並確認復原後的狀態是「刪除前的那個」而不是初始狀態。

**Gate：任一項未過 → 回階段二修正，不得回報完成。**

不要口頭宣稱「應該沒問題」；沒有貼出指令輸出，就不算驗證過。

---

## 跑起來

### 本機開發

```bash
bash start.sh --infra          # 只起 postgres / redis / minio
yarn install                   # workspaces，一次裝完四個套件
yarn seed                      # 建表 + 示範資料(可重複執行)
yarn start                     # 六個行程一起跑(前端 3005)
```

單獨啟動某個行程：`yarn api` / `yarn tiles` / `yarn worker` / `yarn report-worker` / `yarn scheduler`。
**除 `yarn api` 外都要帶 `RUN_MIGRATIONS=false`。**

改到 `packages/shared` 時要重建它（`yarn build:shared`）——
`yarn start` 會先做一次，但開發途中改了共用常數，nodemon 不會替你重建。

背景執行要用 `setsid --fork nohup`，否則行程會跟著 shell 一起被收掉。

### 完整部署

```bash
bash start.sh --seed           # 建置並啟動全部，含監控
bash clean.sh                  # 停止(保留資料)
```

### 對外入口

| 服務 | 網址 |
|---|---|
| 前端 | http://localhost:18080 |
| API 文件 | http://localhost:13008/api-docs |
| Grafana 日誌 | http://localhost:13000 |
| MinIO 主控台 | http://localhost:19001 |

**埠號刻意避開 web_server 專案**（那套佔用 80/443/5432/6379/9000）。改埠號時兩邊都要確認。

另有**備援入口**：`HTTP_ALT_PORT=8080 docker compose up -d nginx`。
給拿不到主要 port 的環境用，內容完全相同，兩個 server block 共用 `nginx/conf/site.inc`。
不設就只綁 `127.0.0.1`，等於沒開。

示範帳號：`DEMO` / `admin`、`inspector`、`worker1`、`viewer`，密碼皆為 `Demo1234`。

---

## 交付：原始碼保護與離線包

### 後端不以明碼交付

`tsc` 的產出是可讀的 JavaScript，交付出去等於把商業邏輯、查詢條件與資料表結構一起交出去。
`scripts/protect.js` 在建置後把它換成等價但難讀的形式。

```bash
yarn build:api:prod                 # tsc + 混淆
PROTECT_SOURCE=false yarn build:api:prod   # 跳過(除錯用)
```

Dockerfile 的 `backend-build` 階段預設會做，`--build-arg PROTECT_SOURCE=false` 可關掉。

**這不是加密，是提高抄襲成本。** 任何在對方機器上執行的程式，對方終究拿得到它的行為；
真正不能外流的東西不該放在交付的映像檔裡。

三個刻意的取捨（改設定前先讀 `protect.js` 的註解）：

- 不開 `controlFlowFlattening` / `deadCodeInjection` —— 膨脹三到五倍且啟動變慢，
  而 NestJS 每次啟動都要跑完整個 DI 圖。
- **保留類別名稱**（`reservedNames: ['^[A-Z]...']`）—— DI、Swagger schema、
  TypeORM 實體名都靠它；改掉之後出事沒有人查得下去。
- 刪掉 source map —— 留著等於把原始碼原封不動附在旁邊。

改動混淆設定後**一定要實際啟動一次**：混淆會改寫每一個 `.js`，
改壞了只有在啟動時才看得出來。

### 離線部署包

目標機器常常連不到外網（廠區、機房、標案指定的內網），
「到現場再 docker pull」不是可行的部署方式。

```bash
bash scripts/pack-offline.sh [版本號]
# → dist-offline/road-patrol-<版本>-offline.tar.gz
```

包含：所有映像檔（`docker save` 成一個 tar，共用 layer 只存一份）、
`docker-compose.yml`（自建服務的 `build:` 已改寫成 `image:`）、
`config/` `nginx/` `monitoring/`、`.env.example`、`install.sh`、`SHA256SUMS`。

**`.env` 不進去** —— 那是每個站台各自的機密，帶著別人的 `.env` 上線是最容易發生的事故。
`install.sh` 會擋住還留著 `change-me` 的 `.env`。

---

## CI/CD

| 檔案 | 觸發 | 做什麼 |
|---|---|---|
| `.github/workflows/ci.yml` | push / PR | 型別 → 單元測試 → 端到端 → 映像檔建置 |
| `.github/workflows/release-offline.yml` | tag `v*` / 手動 | 驗證(含**混淆後啟動測試**) → 產離線包 → 附到 Release |
| `.github/workflows/deploy.yml` | tag `v*` / 手動 | 建置推送映像 → SSH 部署 → 健康檢查失敗自動回滾 |

分成多個 job 而不是一支長腳本，是為了讓失敗訊息直接指出「哪一層壞了」——
型別錯誤與 E2E 失敗需要的處理方式完全不同。

新增測試檔時不必改 workflow；但新增一個**需要外部服務**的測試，
要確認 `ci.yml` 的 `e2e` job 的 `services:` 有那個服務。

---

## 排錯

| 症狀 | 原因 |
|---|---|
| `Entity metadata for X#y was not found` | 新實體沒加進 `ALL_ENTITIES` |
| `Nest can't resolve dependencies of the XService` | 用了別的模組的 service，但模組沒 `imports` 對方的 module |
| `Custom Id cannot contain :` | BullMQ 的 `jobId` 用了冒號 |
| `Cannot read properties of undefined (reading 'databaseName')` | 分頁查詢的 `orderBy` 用了欄位名，要改成屬性名 |
| `res.status is not a function` | 例外過濾器沒有排除 RPC 情境（`host.getType() !== 'http'`）|
| 登入回「帳號或密碼錯誤」但密碼是對的 | 連續失敗 5 次已鎖定 15 分鐘，`docker exec patrol-redis redis-cli del 'login:lock:DEMO:admin'` |
| 排程狀態是空的 | `scheduler` 行程沒起來（狀態由它寫進 Redis，api 只負責讀）|
| WebSocket 連得上但收不到推播 | 全域守衛沒排除非 HTTP 情境；或頻道沒加進 `WS_CHANNEL` |
| 向量圖磚永遠是空的 | 幾何沒轉到 3857，或舊的空圖磚還在 Redis 快取裡 |
| 安全表頭在網頁上沒出現、靜態檔卻有 | nginx 的 `add_header` 是**取代**不是累加 —— 子 location 只要自己寫了一個，父層的全部會被丟掉。凡是有自己 add_header 的 location 都要再 include `security-headers.inc` |
| 走備援 port 時簽名網址／重導向指回錯的 port | proxy 用了 `$host`（會吃掉 port），要改 `$http_host` |
| 前端資料抓兩遍 | 元件被渲染兩次（用 `useMediaQuery` 決定位置，不要用 CSS 顯示兩份）|
| 版本比較回 404 | 該版本的歷程沒有 `snapshot`（直接用 repository 寫入的歷程會這樣）|
| **復原後回到了初始狀態而不是刪除前的狀態** | 中間某次狀態變動沒寫歷程 —— 通常是別的模組改的 |
| **一張沒有施工人員的單卻是「施工中」** | 撤回／復原沒有走 workerStatus 的下限 |
| 對話框翻頁按了不動 | 索引用了外部傳入的初始 id，要用內部的「目前這筆」|
| 勾選框一按就打開詳情 | 可點擊的列裡的控制項要 `stopPropagation` |
| Playwright strict mode violation | 說明文字也含同樣字串，用 `exact: true`、role 或 `.first()` |
| 混淆後啟動就掛 | 混淆設定動到了類別名稱，或關掉了 `reservedNames` |
| 前端建置說 shared 沒有匯出某個名稱 | 只建了 CJS —— Rollup 看不穿 CJS 的 `export *`，要一併建 ESM |
| 改了共用常數但畫面沒變 | `packages/shared` 沒重建（`yarn build:shared`）|
| 篩選後的 `TOTAL` 跟實際筆數對不上 | 篩選寫在分頁之後的 JS 裡，要推進 SQL |

---

## 隱私與界線

這是**公開的示範專案**，會被放上個人 GitHub。

**不得放入**：真實客戶名稱、真實案件資料、公司內部網址與 IP、任何來自 `web_server` 的機密設定、`.env` 的實際值。

示範資料一律合成（固定亂數種子），公司名用「示範工程公司」，機關用「示範市政府建設局」。

新增示範資料後跑一次：

```bash
bash .claude/skills/patrol-dev/scripts/check.sh   # 隱私掃描包含在裡面
```

要比對的真實識別字放在 `.claude/private-terms.txt`（**不進版控**）——
把客戶名稱寫在這個公開專案的腳本裡，等於自己列出「我們的客戶是誰」，
正好是這個掃描要防的那件事。清單不存在時掃描會跳過並提醒。

---

## 目前狀態

- 六個行程與監控三件套都能以 compose 啟動，映像檔建置正常
- 示範資料 1,800 案件 / 180 巡查單 / 400+ 派工單 / 5,400 軌跡點 / 36 路段（`SEED_SCALE` 可放大）
- 導覽資料驅動；圖台單一地圖多圖層；三種渲染模式（案件／聚合／熱點）
- 巡查單 → 派工單的完整流程：轉派、撤回、刪除、復原，以及它們之間的守門條件
- 派工單可指派多人（關聯表），也可以先不指派；施工單位分自主／廠商／公所
- 歷程版本化，五種實體（案件／巡查單／派工單／標案／檢測）共用一組端點，可比較與還原
- 派工單與巡查單照片走 multipart，欄位名即照片類型；完工前檢查必要照片齊不齊
- 圖片一律走 `components/image/ImageViewer`（滾輪縮放／拖曳平移／鍵盤 ←→ +- 0 Esc）。
  **不要用 `react-image-magnifiers`** —— 已停更，手一離開就回到原狀，沒辦法放大後停著看。
- ZIP 照片在前端解（`models/utils/zipModel`，用 fflate）；blob URL 記得 revoke。
- 清單有縮圖（`components/query/ImageCell`）；圖片以短效簽名網址提供，
  簽名要用**對外**位址(`storage.minio.publicEndPoint`)—— S3 簽章涵蓋 Host，簽完再換網址一律 403
- 組織三層（平台／廠商／外包）：只看得到自己的子樹，開不出自己沒有的權限
- 日夜佈景切換；底圖預設 NLSC 臺灣電子地圖，另有正射影像、土地利用、Google、深/淺色共 10 種
- 憑證過期會自動踢出並說明原因；每 20 分鐘主動續期
- 後端交付產物已做原始碼保護；離線包可一鍵打包與安裝

## 還沒做的事

- 案件的原始照片只存路徑（示範資料沒有實體檔案）；派工單與巡查單照片則是完整的上傳／預覽／刪除。
- 報表的 Word 版只列前 200 筆明細（超過請看 Excel）；報表尚未涵蓋巡查單。
- 巡查單還沒上圖台 —— 目前只有列表；要疊到地圖上需要在 `MapContext` 登錄一種新圖層。
- Google 街景**內嵌**需要 Maps API 金鑰（設 `VITE_GOOGLE_MAPS_KEY`）；
  沒金鑰時走免金鑰的外開連結，或切 Mapillary 內嵌。
- 沒有 TLS：Demo 用 HTTP，正式站台要補 certbot 與 HSTS。
- 前端只在 Playwright(Chromium headless)驗證過，沒有在真實桌機瀏覽器目視確認過視覺細節。
