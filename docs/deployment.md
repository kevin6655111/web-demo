# 部署與 CI/CD

## 一鍵部署

```bash
cp .env.example .env && vi .env    # 填機密
bash start.sh --seed               # 建置、啟動、灌示範資料
```

| 服務 | 網址 |
|---|---|
| 前端 | http://localhost:18080 |
| API 文件 | http://localhost:13008/api-docs |
| Grafana 日誌 | http://localhost:13000 |
| MinIO 主控台 | http://localhost:19001 |

埠號刻意避開常見預設值（80/5432/6379/9000），才不會和機器上其他專案打架。

## 停止

```bash
bash clean.sh           # 停止並移除容器(保留資料)
bash clean.sh --purge   # 額外移除映像檔
bash clean.sh --wipe    # 連同資料一起刪除(會二次確認)
```

## 容器與資源

| 容器 | 記憶體上限 | 為什麼 |
|---|---|---|
| `worker` | 1g | 案件處理要吞吐，多開沒關係 |
| `report-worker` | 2g | 一份報表就吃幾百 MB |
| `scheduler` | 單一實例 | 每日備份不能跑十次 |

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

## CD

`.github/workflows/deploy.yml`，**手動觸發或推 tag 才部署**。

不做「推 main 就自動上線」：這個系統的使用者是現場人員，
上線時機要配合他們的作業時間，不是配合開發者的推送時間。

流程：建置映像 → 推到 registry（同時打版本標籤與 latest）→ SSH 到主機 →
`docker compose pull` → `up -d` → 健康檢查 30 次 → 沒過就自動回滾。

先拉映像再切換，把下載時間排除在停機時間之外。

## 需要的 secrets 與變數

| 名稱 | 類型 | 用途 |
|---|---|---|
| `REGISTRY` | variable | 映像倉庫位址 |
| `DEPLOY_PATH` | variable | 主機上的專案路徑 |
| `REGISTRY_USER` / `REGISTRY_TOKEN` | secret | 推映像 |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_KEY` | secret | SSH 部署 |

## 上線前檢查

- [ ] `.env` 的每個密碼都換過（`openssl rand -hex 32` 產 JWT_SECRET）
- [ ] `config.prod.yaml` 的主機位址指向正式資料庫
- [ ] Nginx 補上 TLS 憑證與 HSTS（Demo 走 HTTP）
- [ ] Grafana 密碼換過，`GF_AUTH_ANONYMOUS_ENABLED` 保持 false
- [ ] MinIO bucket 確認**不是**公開讀取
- [ ] 資料庫備份排程實際跑過一次並驗證還原
