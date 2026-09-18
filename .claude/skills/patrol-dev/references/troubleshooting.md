# 排錯對照表

症狀 → 原因。這張表的每一列都是實際踩過的，不是想像出來的可能性 ——
所以「原因」那一欄講的是根因，不是「檢查看看是不是…」。

先確認**行程有沒有起來**再查程式：`patrol_health`（MCP）或 `ss -ltn`。
「功能沒反應」十次有八次是某個行程沒起來。

| 症狀                                                           | 原因                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Entity metadata for X#y was not found`                        | 新實體沒加進 `ALL_ENTITIES`                                                                                                                                           |
| `Nest can't resolve dependencies of the XService`              | 用了別的模組的 service，但模組沒 `imports` 對方的 module                                                                                                              |
| `Custom Id cannot contain :`                                   | BullMQ 的 `jobId` 用了冒號                                                                                                                                            |
| `Cannot read properties of undefined (reading 'databaseName')` | 分頁查詢的 `orderBy` 用了欄位名，要改成屬性名                                                                                                                         |
| `res.status is not a function`                                 | 例外過濾器沒有排除 RPC 情境（`host.getType() !== 'http'`）                                                                                                            |
| 登入回「帳號或密碼錯誤」但密碼是對的                           | 連續失敗 5 次已鎖定 15 分鐘，`docker exec patrol-redis redis-cli del 'login:lock:DEMO:admin'`                                                                         |
| 排程狀態是空的                                                 | `scheduler` 行程沒起來（狀態由它寫進 Redis，api 只負責讀）                                                                                                            |
| WebSocket 連得上但收不到推播                                   | 全域守衛沒排除非 HTTP 情境；或頻道沒加進 `WS_CHANNEL`                                                                                                                 |
| 向量圖磚永遠是空的                                             | 幾何沒轉到 3857，或舊的空圖磚還在 Redis 快取裡                                                                                                                        |
| 安全表頭在網頁上沒出現、靜態檔卻有                             | nginx 的 `add_header` 是**取代**不是累加 —— 子 location 只要自己寫了一個，父層的全部會被丟掉。凡是有自己 add_header 的 location 都要再 include `security-headers.inc` |
| 走備援 port 時簽名網址／重導向指回錯的 port                    | proxy 用了 `$host`（會吃掉 port），要改 `$http_host`                                                                                                                  |
| 前端資料抓兩遍                                                 | 元件被渲染兩次（用 `useMediaQuery` 決定位置，不要用 CSS 顯示兩份）                                                                                                    |
| 版本比較回 404                                                 | 該版本的歷程沒有 `snapshot`（直接用 repository 寫入的歷程會這樣）                                                                                                     |
| **復原後回到了初始狀態而不是刪除前的狀態**                     | 中間某次狀態變動沒寫歷程 —— 通常是別的模組改的                                                                                                                        |
| **一張沒有施工人員的單卻是「施工中」**                         | 撤回／復原沒有走 workerStatus 的下限                                                                                                                                  |
| 對話框翻頁按了不動                                             | 索引用了外部傳入的初始 id，要用內部的「目前這筆」                                                                                                                     |
| 勾選框一按就打開詳情                                           | 可點擊的列裡的控制項要 `stopPropagation`                                                                                                                              |
| Playwright strict mode violation                               | 說明文字也含同樣字串，用 `exact: true`、role 或 `.first()`                                                                                                            |
| 混淆後啟動就掛                                                 | 混淆設定動到了類別名稱，或關掉了 `reservedNames`                                                                                                                      |
| 前端建置說 shared 沒有匯出某個名稱                             | 只建了 CJS —— Rollup 看不穿 CJS 的 `export *`，要一併建 ESM                                                                                                           |
| 改了共用常數但畫面沒變                                         | `packages/shared` 沒重建（`yarn build:shared`）                                                                                                                       |
| 篩選後的 `TOTAL` 跟實際筆數對不上                              | 篩選寫在分頁之後的 JS 裡，要推進 SQL                                                                                                                                  |
| `property XXX should not exist`                                | 查詢面板送了 DTO 沒有的欄位，兩邊要同步                                                                                                                               |
| 篩選條件設了卻沒作用                                           | DTO 收了但服務沒實作，條件被安靜忽略                                                                                                                                  |
| 併發建單時大量 duplicate key                                   | 沒有走 `caseEncodeService`，自己用 MAX+1 取號                                                                                                                         |
| 郵件永遠停在 PENDING                                           | `mail-worker` 行程沒起來                                                                                                                                              |
| Redis 掛掉時請求整個卡住而不是報錯                             | 連線用了預設的離線佇列，命令會無限期排隊                                                                                                                              |
| 剛改完標案但列表沒更新                                         | 寫入路徑漏了 `delByPrefix(PROJECT_CACHE_PREFIX)`                                                                                                                      |
| `yarn start` 說 EADDRINUSE                                     | 前一次的行程還在，`kill -TERM -<pgid>` 收掉整棵樹                                                                                                                     |
| 逆地理編碼回傳的路名不像真的                                   | 該座標 150 公尺內沒有門牌，退回了合成路名                                                                                                                             |
| 座標明明在市區，行政區卻回 null                                | 用了 `ST_Contains`，邊界上的點不算在內；改 `ST_Intersects`                                                                                                            |
| 同一個座標每次查到不同的里                                     | 多重命中沒有確定性排序（要 層級 → 面積 ASC → id ASC）                                                                                                                 |
| 車機的 ECU 資料偶爾整包消失                                    | 兩個來源同時做「讀整包 JSON → 改一欄 → 寫回」；改用 Redis hash 的 `HSET`／`HINCRBY`                                                                                    |
| 每日檢查同一台車同一天有兩列互相矛盾的結論                     | 重算沒有清掉「這次沒重算到」的舊列                                                                                                                                    |
| 每小時的排程把同一組資料一直往下疊                             | 唯一鍵含可為 NULL 的欄位，`ON CONFLICT` 命中不了；要 `UNIQUE NULLS NOT DISTINCT`                                                                                       |
| 沒上傳的車在每日檢查裡看不到                                   | 以案件為主表統計；要與軌跡 `FULL OUTER JOIN`                                                                                                                          |
| `pkill` 之後自己的 shell 也死了(exit 144)                      | 樣式 match 到執行它的 shell；用 `scripts/restart-api.sh`（找 listener）或 `restart-scheduler.sh`（按 PGID）                                                           |
| 重啟後跑的還是舊程式碼                                         | 只殺了最下層的 node，上面的 npm 包裝又拉了一個舊的起來；要按 PGID 收整棵樹                                                                                            |
| 圖台的破壞查詢回 500                                           | `tiles` 行程沒起來（圖層走 3010 不是 3008）                                                                                                                           |
| 案件清單沒有縮圖、圖片測試全失敗                               | 沒跑過 `yarn seed:images`                                                                                                                                             |
| 對外文件裡出現了不該給對方看的端點                             | 端點掛了兩個 tag —— `@ApiTags` 在類別與方法層是累加的；對接端點要放進 `integration/` 這個獨立模組                                                                     |

