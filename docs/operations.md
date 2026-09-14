# 維運手冊

## 日誌監控

Grafana http://localhost:13000（帳密在 `.env`）。

儀表板「道路巡查 Demo — 日誌監控」四個區塊：

| 面板                                    | 看什麼                                               |
| --------------------------------------- | ---------------------------------------------------- |
| 錯誤數 / 認證失敗 / 權限不足 / 排程失敗 | 四個關鍵數字，異常時第一眼                           |
| 各服務日誌量                            | **突然歸零比錯誤變多更值得警覺** —— 那代表服務沒在跑 |
| 案件建立 vs 冪等回放                    | 兩條線的比例就是上游重送率                           |
| 佇列處理結果                            | 完成與失敗的比例                                     |
| 即時日誌                                | 用關鍵字過濾，例如輸入案件編號追出它經過哪些服務     |

Loki 保留 7 天。標籤只有 `container` 與 `level` ——
把 request_id 或使用者放進標籤會產生數以萬計的資料流（cardinality 爆炸）。

## 常見問題排除

| 症狀                                                           | 原因與處理                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `Entity metadata for X#y was not found`                        | 新實體沒加進 `database.module.ts` 的 `ALL_ENTITIES`        |
| `Custom Id cannot contain :`                                   | BullMQ 的 `jobId` 用了冒號                                 |
| `Cannot read properties of undefined (reading 'databaseName')` | 分頁查詢的 `orderBy` 用了欄位名，要改成實體屬性名          |
| `res.status is not a function`                                 | 例外過濾器沒排除 RPC 情境                                  |
| WebSocket 連得上但收不到推播                                   | 全域守衛沒排除非 HTTP 情境，事件被安靜擋掉                 |
| 登入回「帳號或密碼錯誤」但密碼是對的                           | 連續失敗 5 次已鎖定 15 分鐘                                |
| 排程狀態是空的                                                 | `scheduler` 行程沒起來（狀態由它寫進 Redis，api 只負責讀） |
| 圖磚永遠是空的                                                 | 幾何沒轉到 3857；PostGIS 不報錯，只回空圖磚                |
| 報表一直停在 PENDING                                           | `report-worker` 沒起來，或 Redis 連線斷了                  |

## 解除帳號鎖定

```bash
docker exec patrol-redis redis-cli del 'login:lock:DEMO:admin'
```

## 手動觸發排程

系統管理 → 排程 → 執行。或：

```bash
curl -X POST http://localhost:13008/api/task/trigger \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"KEY":"addressGeocoder"}'
```

排程略過時回應會說明原因（未啟用、執行中、其他實例執行中）。

## 排程清單

| 排程                | 時間               | 做什麼                      |
| ------------------- | ------------------ | --------------------------- |
| `caseAutoCode`      | 07–22 每分鐘       | 把案件掛到當期標案          |
| `databaseBackup`    | 每日 23:50         | 備份（Demo 只做備份前檢查） |
| `lineNotify`        | 每日 14:00、18:00  | 找出逾期未完工的派工單      |
| `roadEvalStat`      | 每日 23:00         | 道路評估統計                |
| `dailyCheck`        | 08:45–23:45 每小時 | 確認今天有沒有案件進來      |
| `patrolPointCov`    | 每小時             | 巡查覆蓋率統計              |
| `addressGeocoder`   | 每日 20:00         | 補齊缺路名的案件            |
| `pathUpdater`       | 每日 01:00         | 清理過期報表                |
| `dashboardSync`     | 每日 23:30         | 清儀表板快取                |
| `tilesWarmup`       | 每日 07:00、08:00  | 預熱圖層快取                |
| `partitionMaintain` | 每月 1 日 03:00    | 資料表維護                  |

排程有三層防重複：行程內旗標、Redis 分散式鎖、逾時自動釋放。

## 快取

| 鍵前綴                          | 內容               | TTL            |
| ------------------------------- | ------------------ | -------------- |
| `idem:*`                        | 冪等回應           | 10 分鐘        |
| `layer:*`                       | GeoJSON 圖層       | 5 分鐘         |
| `mvt:*`                         | 向量圖磚           | 10 分鐘        |
| `dashboard:*`                   | 儀表板             | 60 秒          |
| `fleet:*` / `presence:*`        | 即時位置與線上狀態 | 2 分鐘 / 60 秒 |
| `lock:task:*`                   | 排程鎖             | 依各排程逾時   |
| `login:fail:*` / `login:lock:*` | 登入失敗計數與鎖定 | 15 分鐘        |

清單一種快取：

```bash
docker exec patrol-redis redis-cli --scan --pattern 'mvt:*' | \
  xargs -r docker exec -i patrol-redis redis-cli del
```

## 資料量與效能

示範資料：1,800 案件、5,400 軌跡點、36 路段。`SEED_SCALE=5 yarn seed` 可放大。

| 情境           | 作法                                                 |
| -------------- | ---------------------------------------------------- |
| 地圖點位上千   | 改用聚合或熱點模式，或改用向量圖磚端點               |
| 軌跡一天十萬點 | 後端等距抽樣（`MAX_POINTS`），前端畫不動也看不出差別 |
| 報表三萬列     | 非同步產製，上限 50000 列                            |
| 案件表持續成長 | 保留期由排程控制；正式站台應改為按季分區表           |
