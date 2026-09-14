# 部署與 CI/CD

## 一鍵部署

```bash
cp .env.example .env && vi .env    # 填機密
bash start.sh --seed               # 建置、啟動、灌示範資料
```

| 服務         | 網址                            |
| ------------ | ------------------------------- |
| 前端         | http://localhost:18080          |
| API 文件     | http://localhost:13008/api-docs |
| Grafana 日誌 | http://localhost:13000          |
| MinIO 主控台 | http://localhost:19001          |

埠號刻意避開常見預設值（80/5432/6379/9000），才不會和機器上其他專案打架。

### 備援入口

有些環境拿不到主要 port（防火牆只放行特定 port、或機房只配一個給我們）。
nginx 另外聽一個 8081，提供**完全相同**的服務：

```bash
HTTP_ALT_PORT=8080 docker compose up -d nginx   # 客戶改連 http://主機:8080
```

不設 `HTTP_ALT_PORT` 就只綁在 `127.0.0.1`，等於沒對外開。

兩個 server block 共用 `nginx/conf/site.inc` —— 分成兩份的話，改了一邊忘了另一邊，
而「僅走備援 port 的客戶端出現異常」屬於最難重現的問題類型。

proxy 一律用 `$http_host` 而不是 `$host`：**`$host` 會把 port 吃掉**，
走備援 port 時後端不知道自己是被從 `:8080` 存取的，
它產生的絕對網址（簽名網址、重導向）會指回沒開放的那個 port。

正式站台補 TLS 時，兩個 block 一起加 `ssl` 即可。注意 Let's Encrypt 的
HTTP-01 只認 port 80，備援 port 簽不到憑證。

## 停止

```bash
bash clean.sh           # 停止並移除容器(保留資料)
bash clean.sh --purge   # 額外移除映像檔
bash clean.sh --wipe    # 連同資料一起刪除(會二次確認)
```

## 離線部署包

目標機器常常連不到外網（廠區、機房、標案指定的內網），
「到現場再 `docker pull`」不是可行的部署方式。

```bash
bash scripts/pack-offline.sh v2.0.0
# → dist-offline/road-patrol-v2.0.0-offline.tar.gz
```

打包對象為**映像檔本身**而非原始碼：交付的是可直接執行的產物，
不需在目標主機重新建置，也不受其建置環境差異影響。

包含：

| 內容                             | 說明                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `images.tar.gz`                  | 全部映像匯出為單一 tar，共用 layer 僅保存一份；分開匯出會重複保存基礎映像         |
| `docker-compose.yml`             | 自建服務的 `build:` 已改寫成 `image:`（離線機器沒有原始碼可建）                   |
| `config/` `nginx/` `monitoring/` | 設定檔                                                                            |
| `.env.example`                   | **不含 `.env`** —— 該檔案為各站台專屬機密，沿用他站設定是常見的部署事故           |
| `install.sh`                     | 檢查環境 → 驗 SHA256 → `docker load` → `up -d` → 等健康檢查                       |
| `SHA256SUMS`                     | 可攜式媒體的傳輸損毀並不罕見，而損毀的映像在 `docker load` 時的錯誤訊息不具指向性 |

目標機器上：

```bash
tar -xzf road-patrol-v2.0.0-offline.tar.gz
cd road-patrol-v2.0.0
cp .env.example .env && vi .env    # install.sh 會擋住還留著 change-me 的 .env
bash install.sh [--seed]
```

## 後端不以明碼交付

`tsc` 的產出是可讀的 JavaScript。交付出去等於把商業邏輯、查詢條件與資料表結構
一起交出去，所以建置時多一步混淆（`app/scripts/protect.js`）。

```bash
yarn build:api:prod                          # 建 shared + 建 api + 混淆
PROTECT_SOURCE=false yarn build:api:prod     # 跳過(除錯用)
docker build --build-arg PROTECT_SOURCE=false ...   # 除錯用的映像
```

保護會刪掉 `packages/shared/dist` 的 `.d.ts`，下一次 `tsc` 就找不到共用套件的型別 ——
所以 `build:api:prod` 自己先重建一次 shared。手動跑過 `node scripts/protect.js` 之後，
編輯器要等下一次 `yarn build:shared` 才恢復。

Dockerfile 的 `backend-build` 階段預設會做。

**`packages/shared` 也在保護範圍內**：領域語彙搬過去之後，資料表結構、狀態機、
代碼表全都在那裡 —— 只混淆 `apps/api` 等於把最值錢的那一份原封不動附在旁邊。
`.d.ts` 也會一併刪除（它把每個常數的字面值寫得清清楚楚）。

處理後，全部產出中僅餘 3 處明文領域字串，皆為雙字詞
（混淆器不將過短字串移入字串表）。此長度的字串本身不具保護價值。

**此機制的目的是提高還原成本，而非加密。** 在對方主機上執行的程式，其行為終究可被觀察；
不可外流的內容不應包含在交付的映像檔中。

三個刻意的取捨：

- 不開 `controlFlowFlattening` / `deadCodeInjection` —— 膨脹三到五倍且啟動變慢，
  而 NestJS 每次啟動都要跑完整個 DI 圖。
- **保留類別名稱** —— DI、Swagger schema、TypeORM 實體名都靠它；
  變更後例外堆疊將無法識別，故障時無從追查。
- 刪掉 source map —— 留著等於把原始碼原封不動附在旁邊。

混淆會改寫每一個 `.js`，**改壞了只有在啟動時才看得出來**，
所以 CI 在打包前會真的把它跑起來問一次健康檢查。

## 容器與資源

| 容器            | 記憶體上限 | 為什麼                     |
| --------------- | ---------- | -------------------------- |
| `worker`        | 1g         | 案件處理要吞吐，多開沒關係 |
| `report-worker` | 2g         | 一份報表就吃幾百 MB        |
| `scheduler`     | 單一實例   | 每日備份不能跑十次         |

**只有 `api` 跑 migration**，其餘行程的 compose 設 `RUN_MIGRATIONS=false` ——
多個行程同時改 schema 會互相鎖死。`depends_on: api healthy` 確保順序。

## CI

`.github/workflows/ci.yml`，四個 job：

```
lint(型別與規則) ─┬─▶ unit(單元測試 + 建置) ─┬─▶ e2e(Playwright)
                  └─▶ docker(映像檔建置)     ┘
```

分開的理由是**讓失敗訊息直接指出哪一層壞了** —— 型別錯誤與 E2E 失敗需要的處理方式完全不同。

E2E job 會拉起 PostGIS / Redis / MinIO 三個 service container，跑 seed，
啟動五個行程，用 `wait-on` 等到真的就緒（不睡固定秒數 —— CI 機器的速度每次都不一樣），
再跑 Playwright。失敗時上傳截圖、影片與 trace，保留 7 天。

## Release：離線包

`.github/workflows/release-offline.yml`，**推 tag `v*` 或手動觸發**。

```
verify(型別 + 測試 + 混淆後啟動測試) ──▶ bundle(打包 → artifact → 附到 Release)
```

打包程序本身不具偵錯能力：混淆若破壞程式碼，只會在目標主機啟動時顯現。
因此 `verify` 階段會實際啟動混淆後的後端並確認健康檢查通過。

離線包體積約 1–2 GB，僅在 tag 或手動觸發時產生，artifact 保留 14 天。

## CD

`.github/workflows/deploy.yml`，**手動觸發或推 tag 才部署**。

不做「推 main 就自動上線」：這個系統的使用者是現場人員，
上線時機要配合他們的作業時間，不是配合開發者的推送時間。

流程：建置映像 → 推到 registry（同時打版本標籤與 latest）→ SSH 到主機 →
`docker compose pull` → `up -d` → 健康檢查 30 次 → 沒過就自動回滾。

先拉映像再切換，把下載時間排除在停機時間之外。

## 需要的 secrets 與變數

| 名稱                                         | 類型     | 用途             |
| -------------------------------------------- | -------- | ---------------- |
| `REGISTRY`                                   | variable | 映像倉庫位址     |
| `DEPLOY_PATH`                                | variable | 主機上的專案路徑 |
| `REGISTRY_USER` / `REGISTRY_TOKEN`           | secret   | 推映像           |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY` | secret   | SSH 部署         |

離線包不需要任何 secret —— 它產在 CI 上，由人帶到現場。

## 上線前檢查

- [ ] `.env` 的每個密碼都換過（`openssl rand -hex 32` 產 JWT_SECRET）
- [ ] `config.prod.yaml` 的主機位址指向正式資料庫
- [ ] Nginx 補上 TLS 憑證與 HSTS（Demo 走 HTTP）
- [ ] Grafana 密碼換過，`GF_AUTH_ANONYMOUS_ENABLED` 保持 false
- [ ] MinIO bucket 確認**不是**公開讀取
- [ ] 安全表頭真的有出現在**網頁**回應上（`curl -I http://主機:18080/`）——
      nginx 的 `add_header` 是取代不是累加，子 location 只要自己寫了一個就會蓋掉父層全部
- [ ] 資料庫備份排程實際跑過一次並驗證還原
- [ ] 交付用的映像確認有做原始碼保護（`docker run ... cat apps/api/dist/main/api.js | head` 看得到明碼就是沒做）
