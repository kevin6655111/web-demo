---
name: patrol-dev
description: 開發道路巡查 Demo（NestJS 微服務 + PostGIS + BullMQ + WebSocket + React）。當使用者要新增或修改 API、資料表、排程、佇列、報表、派工、權限、圖層、即時通訊、儀表板，或要求跑起來、測試、部署、除錯此專案時使用。關鍵字：加 API、改資料表、新增排程、報表、派工、權限、WebSocket、遷移、migration、seed、跑起來、部署。
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

模組位置：`app/server/src/<領域>/`，各含 `*.module.ts` `*.controller.ts` `*.service.ts` `*.dto.ts` `entities/`。

前端對話框：`views/components/dialog/` —— `FormDialog`(外框) `ConfirmDialog`
`CaseDetailDialog`(案件詳情，含派工與討論分頁、上下筆翻頁) `CaseEditDialog` `DispatchDialog`
`WorkOrderDialog`(回報與驗收) `ProjectDialog` `UserDialog` `RoleDialog`(權限矩陣)
`VehicleDialog` `PlanDialog` `SurveyDialog` `AnnouncementDialog` `CaseChatPanel`。

領域模組：`auth` `orgstruct`(導覽) `core`(代碼表/公告/驗證碼) `project` `case-patrol` `case-history`
`work-order` `fleet`(車隊/軌跡) `road-eval` `patrol-setting` `survey` `report` `dashboard`
`tiles` `geo` `websocket` `support`(客服) `task` `queue` `storage` `security`。

前端：`app/src/` —— `views/`(畫面) `presenters/`(判斷邏輯) `models/api/`(呼叫層) `hooks/` `context/` `config/`。

**圖台是單一地圖 + 圖層登錄表**（`context/MapContext.jsx`）：
各面板把圖層登錄進來，所以破壞、軌跡、路段、計畫可以疊看。
新增一種圖層要動三個地方：面板(登錄)、`MapCanvas`(畫法)、`LayerControlPanel`(分組)。

---

## 階段一：確認要改哪一層（此階段不寫任何檔案）

1. 讀相關模組，找出**實際的插入點與既有命名**，不要憑印象。
2. 判斷這次的改動落在哪一層，照下表決定作法：

   | 要做的事 | 放哪裡 | 不要放哪裡 |
   |---|---|---|
   | 使用者等得住的查詢/寫入 | `api` 的 controller + service | 不要塞進 worker |
   | 慢、會失敗、要重試 | BullMQ 佇列 + processor | 不要在 API 裡同步做 |
   | 「發生了什麼」的廣播 | Redis 事件 (`EVENT` 常數) | 不要用佇列送通知 |
   | 定時要做的事 | `task-definitions.ts` + `task.service.ts` | 不要用 setInterval |
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
- **權限用 `@RequireAction(ACTION.X.Y)`**，權限字串一律取自 `@constants/module.const`，不要寫字面字串。
- **會被重送的寫入端點要加 `@Idempotent()`**（車機、對接系統、任何有自動重試的上游）。
- **稽核用 `@Audit({ action, keys })`**，`keys` 是白名單 —— 不要把整包 body 寫進日誌。
- **SQL 一律參數化**；`orderBy` 搭配 `skip/take` 時要用**實體屬性名**（`c.detectedAt`）而非欄位名（`c.detected_at`），否則分頁查詢會炸。
- **多租戶**：每個查詢都要有 `company_id` 條件。漏掉就是資料外洩。
- 新增實體要加進 `database.module.ts` 的 `ALL_ENTITIES`（不是 `autoLoadEntities`）。
- **全域守衛與攔截器要排除非 HTTP 情境**（`context.getType() !== 'http'`）——
  微服務事件會繼承它們，沒排除的話每個事件都被安靜擋掉，WebSocket 推播從此不再送出。
- PostGIS 的 `ST_AsMVTGeom` 要先 `ST_Transform` 到 3857；不轉不會報錯，只回空圖磚。

### 冪等三層（改動寫入路徑時務必維持）

1. HTTP `Idempotency-Key` → Redis `SET NX`，回放第一次的回應
2. BullMQ `jobId`（**不可含冒號**，BullMQ 內部用它切 key）
3. 資料庫唯一鍵 `(dt_record, img_detect, crack_id)` 與 `external_id`

Redis 會被清空、視窗會過期，**第三層是唯一不會消失的保證**，不要拿掉。

### 前端硬規則

- 判斷邏輯放 `presenters/`，元件只渲染。顏色、門檻、單位換算都是判斷。
- API 一律走 `models/api/patrolApi.js`，不要在元件裡拼路徑。
- 狀態顏色與中文標籤取自 `styles/theme.js`（`CASE_STATUS_LABEL` / `NEED_REPAIR_LABEL` / `DEGREE_LABEL`
  / `WORK_ORDER_LABEL` / `CRACK_LABEL` / `MATERIAL_LABEL`），不要各處硬寫。
  破壞類型的 key 沿用判讀模型的輸出（`Potholes`、`Alligator_Cracking`…，大小寫照抄）。
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

### migration

```bash
yarn --cwd app migrate:create <MigrationName>   # 產在 server/src/migrations/<年份>/
yarn --cwd app seed                              # 資料(可重複執行)
yarn --cwd app seed:images                       # 示範圖片(SVG，上傳到 MinIO)
```

- 手寫 SQL，不要用自動產生的差異。
- 加欄位到已有資料的表時，**要回填**（例如版本號、快照），否則歷史資料會斷在導入那天。
- 一定要寫 `down()`。
- **事後補約束前要先讓既有資料合法**：直接 `ADD CONSTRAINT` 會被自己的舊資料擋下
  （三層公司那個 migration 就得先補平台層、再把現有公司掛上去）。
- 案件與派工單是**分表**的（主表 / 地址 / 狀態 / 照片 / 取樣）。加欄位前先想清楚
  它是「來源寫進來就不改的」「非同步補的」還是「人會一直改的」—— 放錯表會讓
  車機的大量寫入跟承辦的編輯搶同一列。

---

## 階段三：驗證（必跑，且必須貼出實際輸出）

```bash
cd app
npx tsc --project server/tsconfig.json --noEmit   # 後端型別
yarn test                                          # 前端測試(28 項)
yarn test:e2e                                      # 後端測試(25 項)
yarn test:e2e:browser                              # Playwright(20 項，需服務先跑起來)
npx vite build                                     # 前端建置
```

或一次跑完靜態規則、隱私掃描、型別、測試與建置：

```bash
bash .claude/skills/patrol-dev/scripts/check.sh
```

動到 API 或資料流時，還要實際跑一遍（服務啟動方式見下節），並貼出 curl 的實際回應。

通過標準：

1. 型別檢查零錯誤，測試全綠。
2. 新增或修改 API 時，`http://localhost:3008/api-docs` 看得到該端點且說明完整。
3. 動到寫入路徑時，**實測重送一次**，確認不會產生第二筆資料。

**Gate：任一項未過 → 回階段二修正，不得回報完成。**

不要口頭宣稱「應該沒問題」；沒有貼出指令輸出，就不算驗證過。

---

## 跑起來

### 本機開發

```bash
bash start.sh --infra          # 只起 postgres / redis / minio
cd app && yarn seed            # 建表 + 示範資料(可重複執行)
yarn start                     # 六個行程一起跑(前端 3005)
```

單獨啟動某個行程：`yarn server` / `yarn tiles` / `yarn worker` / `yarn report-worker` / `yarn scheduler`。
**除 `yarn server` 外都要帶 `RUN_MIGRATIONS=false`。**

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

示範帳號：`DEMO` / `admin`、`inspector`、`worker1`、`viewer`，密碼皆為 `Demo1234`。

---

## 排錯

| 症狀 | 原因 |
|---|---|
| `Entity metadata for X#y was not found` | 新實體沒加進 `ALL_ENTITIES` |
| `Custom Id cannot contain :` | BullMQ 的 `jobId` 用了冒號 |
| `Cannot read properties of undefined (reading 'databaseName')` | 分頁查詢的 `orderBy` 用了欄位名，要改成屬性名 |
| `res.status is not a function` | 例外過濾器沒有排除 RPC 情境（`host.getType() !== 'http'`） |
| 登入回「帳號或密碼錯誤」但密碼是對的 | 連續失敗 5 次已鎖定 15 分鐘，`docker exec patrol-redis redis-cli del 'login:lock:DEMO:admin'` |
| 排程狀態是空的 | `scheduler` 行程沒起來（狀態由它寫進 Redis，api 只負責讀） |
| WebSocket 連得上但收不到推播 | 全域守衛沒排除非 HTTP 情境 |
| 向量圖磚永遠是空的 | 幾何沒轉到 3857，或舊的空圖磚還在 Redis 快取裡 |
| 前端資料抓兩遍 | 元件被渲染兩次（用 `useMediaQuery` 決定位置，不要用 CSS 顯示兩份）|
| 版本比較回 404 | 該版本的歷程沒有 `snapshot`（直接用 repository 寫入的歷程會這樣）|
| 對話框翻頁按了不動 | 索引用了外部傳入的初始 id，要用內部的「目前這筆」|
| Playwright strict mode violation | 說明文字也含同樣字串，用 `exact: true`、role 或 `.first()` |

---

## 隱私與界線

這是**公開的示範專案**，會被放上個人 GitHub。

**不得放入**：真實客戶名稱、真實案件資料、公司內部網址與 IP、任何來自 `web_server` 的機密設定、`.env` 的實際值。

示範資料一律合成（固定亂數種子），公司名用「示範工程公司」，機關用「示範市政府建設局」。

新增示範資料後跑一次：

```bash
grep -rniE '覺華|juahua|台中市政府|臺中市政府|新北|桃園|濱海|binhai|211\.23' --include='*.ts' --include='*.tsx' --include='*.jsx' --include='*.yaml' --include='*.md' . | grep -v node_modules
```

無輸出才算過。

---

## 目前狀態

- 測試：後端 25 項、前端 33 項、Playwright 48 項，全過
- 六個行程與監控三件套都能以 compose 啟動，映像檔建置正常
- 示範資料 1,800 案件 / 5,400 軌跡點 / 36 路段（`SEED_SCALE` 可放大）
- 導覽資料驅動；圖台單一地圖多圖層；三種渲染模式（案件／聚合／熱點）
- 案件與派工單依實際營運的資料表分表設計；標案關聯（公司／車輛／工務段轄區）皆為關聯表帶 `is_active`
- 歷程版本化，四種實體（案件／派工單／標案／檢測）共用一組端點，可比較與還原
- 派工單照片走 multipart，欄位名即照片類型；完工前檢查必要照片齊不齊
- 圖片一律走 `components/image/ImageViewer`（滾輪縮放／拖曳平移／鍵盤 ←→ +- 0 Esc）。
  **不要用 `react-image-magnifiers`** —— 已停更，而且手一離開就回到原狀，沒辦法放大後停著看。
- **在可點擊的列裡開對話框，記得 `stopPropagation`**：React 的 portal 事件沿元件樹冒泡，
  不是 DOM 樹 —— 檢視器由列裡的縮圖算繪，不擋的話按放大會順便打開那一列的詳情。
- ZIP 照片在前端解（`models/utils/zipModel`，用 fflate）；blob URL 記得 revoke。
- 清單有縮圖（`components/query/ImageCell`）；圖片以短效簽名網址提供，
  簽名要用**對外**位址(`storage.minio.publicEndPoint`)——S3 簽章涵蓋 Host，
  簽完再換網址一律 403
- 組織三層（平台／廠商／外包）：只看得到自己的子樹，開不出自己沒有的權限
- 日夜佈景切換；顏色一律走主題語彙，不要再硬寫深色值
- 底圖預設 NLSC 臺灣電子地圖，另有正射影像、土地利用、Google、深/淺色共 10 種
- 憑證過期會自動踢出並說明原因；每 20 分鐘主動續期

## 還沒做的事

- 案件的原始照片只存路徑（示範資料沒有實體檔案）；派工單照片則是完整的上傳／預覽／刪除。
- 報表的 Word 版只列前 200 筆明細（超過請看 Excel）。
- Google 街景**內嵌**需要 Maps API 金鑰（設 `VITE_GOOGLE_MAPS_KEY`）；
  沒金鑰時走免金鑰的外開連結，或切 Mapillary 內嵌。
- 沒有 TLS：Demo 用 HTTP，正式站台要補 certbot 與 HSTS。
- 前端只在 Playwright(Chromium headless)驗證過，沒有在真實桌機瀏覽器目視確認過視覺細節。
