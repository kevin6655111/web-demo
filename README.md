# 道路巡查 Demo

以 NestJS 微服務 + PostGIS + React 建構的公共工程巡查系統示範專案。

涵蓋從車機上傳案件、去重與非同步補資料、開立巡查單、派工、施工回報、驗收，
到報表產製與即時看板的完整流程，並針對其中的工程問題提出對應處理：
請求重送的冪等、慢工作的佇列化、單一實例的排程、可回溯的變更歷程、
三層組織的授權傳遞，以及高併發下的案件編號。

> 所有資料皆為合成，公司、機關、案件、座標均為虛構，與任何實際專案無關。

系統設計與取捨見 [docs/internal/architecture.md](docs/internal/architecture.md)，
其餘文件見 [docs/](docs/README.md)。

---

## 技術棧

**後端** — NestJS 11 / TypeScript / TypeORM / PostgreSQL + PostGIS / Redis / BullMQ /
Redis Transport 微服務 / WebSocket(ws) / MinIO(S3) / ExcelJS / docx / Swagger

**前端** — React 18 / MUI 6 / Leaflet / Supercluster / leaflet.heat / Recharts / Vite

**基礎設施** — Docker Compose / Nginx / Grafana + Loki + Promtail / GitHub Actions

**測試** — Vitest（後端 25、前端 33）+ Playwright（66）

專案為 Yarn workspaces：`apps/web`（前端）、`apps/api`（後端，六個行程共用同一份原始碼）、
`packages/shared`（前後端共用的領域語彙）、`e2e`（端對端測試）。

---

## 架設

需求：Node.js 22、Yarn、Docker Engine 與 Compose v2。

### 本機開發

```bash
cp .env.example .env && vi .env    # 填入密碼與金鑰，此檔不進版控
bash start.sh --infra              # 啟動 PostGIS / Redis / MinIO
yarn install && yarn seed && yarn seed:images
yarn start                         # 六個行程一起跑
```

前端位於 http://localhost:3005。

### 完整部署（含監控）

```bash
bash start.sh --seed     # 建置並啟動全部服務
bash clean.sh            # 停止並保留資料
```

| 服務             | 網址                            |
| ---------------- | ------------------------------- |
| 前端             | http://localhost:18080          |
| API 文件         | http://localhost:13008/api-docs |
| Grafana 日誌監控 | http://localhost:13000          |
| MinIO 主控台     | http://localhost:19001          |

對外埠號避開常見預設值（80 / 5432 / 6379 / 9000），以免與機器上其他專案衝突。
若部署環境僅放行特定埠號，設定 `HTTP_ALT_PORT=8080` 可啟用備援入口，服務內容相同。

### 離線部署

目標主機無法連外時，將映像檔連同設定檔打包後帶至現場：

```bash
bash scripts/pack-offline.sh v1.0.0
```

解開後複製 `.env.example` 為 `.env` 並修改密碼，執行 `bash install.sh` 即可。
詳見 [部署與 CI/CD](docs/internal/deployment.md)。

### 示範帳號

登入需要三個欄位：單位代碼 / 帳號 / 密碼。密碼皆為 `Demo1234`。

| 單位             | 帳號        | 角色       | 權限範圍                         |
| ---------------- | ----------- | ---------- | -------------------------------- |
| `ROOT` 平台管理  | `root`      | 系統管理員 | 開通廠商單位的權限與人員額度     |
| `DEMO` 廠商單位  | `admin`     | 系統管理員 | 全部功能，並可開通外包單位       |
| `DEMO`           | `inspector` | 巡查員     | 開立巡查單、建立案件、派工、報表 |
| `DEMO`           | `worker1`   | 施工人員   | 回報施工進度                     |
| `DEMO`           | `viewer`    | 檢視者     | 唯讀                             |
| `SUB01` 外包單位 | `suboffice` | 系統管理員 | 僅限被開通的七項                 |
| `SUB01`          | `subworker` | 施工人員   | 回報施工進度                     |

`suboffice` 的角色為系統管理員，但所屬公司僅被開通七項權限，
登入後取得的是兩者的交集 —— 這是授權傳遞機制實際生效的地方。

---

## 授權

MIT。示範用途，資料皆為合成。
