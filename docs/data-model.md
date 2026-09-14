# 資料模型

## 關聯總覽

```
companies ──┬── users ──── roles
            │
            ├── company_projects ──┐
            │                      │
            ├── vehicles ──┬── vehicle_tracks
            │              └── project_vehicles ──┐
            │                                     │
            │                          projects ──┼── project_sections ── section_areas ── areas
            │                                     │        └── sections
            │                                     │
            │                                     ├── patrol_cases ──┬── patrol_case_addresses
            │                                     │                  ├── patrol_case_statuses
            │                                     │                  └── case_messages
            │                                     │
            │                                     ├── maintenances ──┬── maintenance_statuses
            │                                     │                  ├── maintenance_repairs
            │                                     │                  └── maintenance_images
            │                                     │
            │                                     └── work_orders ──┬── work_order_statuses
            │                                                       ├── work_order_users
            │                                                       ├── work_order_images
            │                                                       └── work_order_improvements
            │
            ├── road_segments ── survey_cases ── survey_orders
            ├── patrol_plans
            ├── report_jobs
            ├── announcements
            └── support_threads ── support_messages

case_histories             (版本化歷程，五種實體共用一張)
modules ── features        (導覽定義，不掛公司)
```

## 組織三層與授權傳遞

```
平台管理(tier 1)  ROOT   ──開通模組與額度──▶  廠商單位(tier 2)  DEMO
                                                    │
                                          ──再開通子集──▶  外包單位(tier 3)  SUB01
```

公司用**自關聯**（`parent_id` + `tier`）而不是三張表：三層的規則完全一樣
（開通、停用、往下傳遞），拆三張表會讓同一段邏輯抄三遍。

兩條規則撐起整個機制：

| 規則                 | 實作                                         | 少了會怎樣               |
| -------------------- | -------------------------------------------- | ------------------------ |
| 只看得到自己的子樹   | 遞迴 CTE 收斂 `company_id`，範圍外一律回 404 | 廠商查得到平台與其他廠商 |
| 開不出自己沒有的權限 | `setGrants` 先比對自己的 `company_grants`    | 廠商自建全權限外包單位   |

**廠商無法得知平台層的存在**：範圍外一律回 404 而非 403。
403 等同於確認「該公司存在但無權存取」，本身即為資訊洩漏。

**使用者權限 = 角色動作 ∩ 公司開通**。這是開通機制唯一真正生效的地方：
少了交集，廠商自己建一個全權限角色就繞過了一切。示範資料裡的
`SUB01/suboffice` 角色是「系統管理員」，登入後只拿得到被開通的七項。

**收回權限會向下遞迴**：上層收回的權限，下層已開通的部分一併停用，
否則將產生上層已無、下層仍存的孤兒授權。

`company_grants` 一列一個動作鍵，記錄是誰、哪個單位開的，停用而不刪除 ——
合約中止後要查得到「當初開通過什麼」。

## 三個結構性的決定

### 一、三種單據都分表

主表只放「來源寫進來就不再改」的內容，人會改的與非同步補的各自一張。

| 表                      | 誰在寫                     | 頻率                   |
| ----------------------- | -------------------------- | ---------------------- |
| `patrol_cases`          | 車機／APP                  | 每天幾千筆，寫完就不動 |
| `patrol_case_addresses` | 逆地理編碼的 worker 或排程 | 案件建立後才補上       |
| `patrol_case_statuses`  | 承辦、主管                 | 一筆案件被改很多次     |

合成一張的代價很具體：車機的大量寫入會跟承辦的編輯搶同一列，
而且地址還沒補到時，案件會因為欄位不完整而卡在寫入這一步 ——
地址是「補得到就好」的東西，不該擋住案件進來。

派工單同理：`work_orders` / `work_order_statuses` / `work_order_users` / `work_order_images` / `work_order_improvements`。
取樣資訊獨立一張是因為只有 `PB`（路基改善）用得到，
放主表的話其他三種類型會多三個永遠是空的欄位。

巡查單也一樣：`maintenances` / `maintenance_statuses` / `maintenance_repairs` / `maintenance_images`。
回填內容（材料、數量、回填尺寸）只有 `RB`（巡修，當場修掉的）有 ——
由 `RB` 改回 `RA` 時那一列整列刪掉，留著會變成
「一張沒有修過的單上寫著用了幾包冷瀝青」。

**施工人員是關聯表而不是欄位**：一個坑洞常是兩三個人一起去。
把 id 逗號串在一個欄位裡，「這個人這個月被派了幾張單」就變成字串比對，
而那是報表每個月都要跑一次的查詢。

### 二、標案關聯用關聯表而不是欄位

`company_projects`、`project_vehicles`、`project_sections` + `section_areas` 都帶 `is_active`。

換廠商、車輛調度、轄區調整都是常態，**但去年的案件仍然要查得到當時是誰在做、哪台車跑的**。
所以是停用而不是刪除 —— 刪掉關聯，舊資料的責任歸屬就消失了。

一個標案常由主辦（`MAIN`）與協力（`SUB`）廠商共同執行，兩邊都要看得到自己的案子，
這也是「標案上放一個 company_id」做不到的事。

轄區掛在「標案-工務段」之下而不是工務段本身：
同一個工務段在不同標案負責的行政區可以不同。

### 三、歷程一張表、五種實體共用

主鍵 `(case_type, case_id, version)`。稽核問的是「這段期間誰改了什麼」——
跨實體的查詢比較常見，分五張表的話每次都要 union。

歷程還有第二個用途：**復原靠它決定要回到哪個狀態**。
所以「別的模組改了我的狀態」也要留一筆 —— 見架構說明的〈版本化歷程〉。

## 主要資料表

| 表                                   | 用途                     | 關鍵約束                                                                                  |
| ------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| `patrol_cases`                       | 破壞案件主表             | `(dt_record, img_detect, crack_id)` 唯一、`external_id` 唯一、`geom` GiST                 |
| `patrol_case_addresses`              | 案件地址（非同步補）     | `case_id` 唯一；`(county, district)`、`road` 索引                                         |
| `patrol_case_statuses`               | 二篩／編輯／修繕三組狀態 | `case_id` 唯一；`status`、`need_repair` 各自索引                                          |
| `maintenances`                       | 巡查單／巡修單主表       | `case_num` 唯一；`(project_id, pothole_number)` **部分**唯一（只管有編號的）、`geom` GiST |
| `maintenance_statuses`               | 巡查單狀態               | `maintenance_id` 唯一；`status` 索引                                                      |
| `maintenance_repairs`                | 巡修回填內容（RB 才有）  | `maintenance_id` 唯一；改回 RA 時整列刪除                                                 |
| `maintenance_images`                 | 巡查照片                 | `(maintenance_id, img_type)` 唯一                                                         |
| `work_orders`                        | 派工單                   | `case_num` 唯一、`case_patrol_id` 唯一、`maintenance_id` **部分**唯一（一來源一單）       |
| `work_order_users`                   | 派工單↔施工人員          | `(work_order_id, user_id)` 唯一；一張單可多人                                             |
| `work_order_images`                  | 施工照片                 | `(work_order_id, img_type)` 唯一 —— 同類型只留一張                                        |
| `case_histories`                     | 版本化歷程               | 主鍵 `(case_type, case_id, version)`；只增不改                                            |
| `projects`                           | 標案                     | `prj_id` 唯一；`(state, start_date, end_date)` 索引                                       |
| `company_projects`                   | 公司↔標案                | `(company_id, project_id)` 唯一 + `role` / `is_active`                                    |
| `project_vehicles`                   | 標案↔車輛                | `(project_id, vehicle_id)` 唯一 + `is_active`                                             |
| `project_sections` / `section_areas` | 工務段與轄區             | 各自的組合唯一 + `is_active`                                                              |
| `vehicle_tracks`                     | 軌跡點                   | 資料量最大；索引只建 `(vehicle_id, recorded_at)` 與空間索引                               |
| `road_segments`                      | 路段評估                 | LineString；`(company_id, code)` 唯一                                                     |
| `report_jobs`                        | 報表工作                 | `dedup_key` 唯一（同條件不重複排）                                                        |
| `companies`                          | 三層組織                 | `parent_id` 自關聯；`CHECK` 保證 tier 1 無上層、tier 2/3 必有上層                         |
| `company_grants`                     | 公司被開通的動作         | `(company_id, action_key)` 唯一；停用而不刪除                                             |
| `modules` / `features`               | 導覽定義                 | 啟動時由程式碼同步                                                                        |

### 案件的三層去重

```
HTTP  Idempotency-Key + Redis SET NX     擋掉「同一次請求」的重送
佇列  BullMQ jobId                        擋掉「同一個事件」的重複投遞
資料庫 (dt_record, img_detect, crack_id)  擋掉前兩層都失效的情況
```

最後一層是唯一一道不依賴應用程式還活著的防線。
車機在隧道裡送出案件、收不到回應就重送 —— 這是常態而不是例外。

### 部分唯一索引

坑洞編號在同一個標案內不可重號（業主的坑洞管制表用它對帳），
但非坑洞的巡查單這個欄位是 `NULL`。一般的唯一索引會讓所有沒有編號的列互相撞，
所以用 `WHERE pothole_number IS NOT NULL` 的部分索引。

派工單的 `maintenance_id` 同理：沒有來源的 `PA`/`PB` 都是 `NULL`。

## 單據狀態

| 單據                                 | 狀態                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| 巡查單 `maintenance_statuses.status` | -1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工            |
| 派工單 `work_order_statuses.status`  | -1 已刪除 / 0 待處理 / 1 施工中 / 2 已回報 / 3 已完工 |

**刪除是狀態而不是真的刪列**：巡查單可能已經被派工單引用，真刪會讓派工單變成孤兒；
而「刪掉的單救得回來」本身就是需求 —— 現場誤刪是常態。

巡查單與案件用同一套語意（待確認 → 觀察中 → 已派工），
因為兩者都是「發現了什麼」；派工單走的才是施工流程。

## 三組狀態的意思

案件有三組彼此獨立的狀態，各自帶異動者與時間。合成一個欄位的話，
「AI 判錯」與「不需要修」會變成同一件事，而模型調校時要分得出來。

| 欄位          | 值                                         | 問的問題                   |
| ------------- | ------------------------------------------ | -------------------------- |
| `status`      | 0 未審 / 1 通過 / 2 待審 / 3 刪除 / 4 誤判 | 這筆 AI 判讀對不對？       |
| `edited`      | 0 未編輯 / 1 已編輯                        | 有沒有被人改過？（稽核用） |
| `need_repair` | -1 已刪除 / 0 待確認 / 1 觀察中 / 2 已派工 | 這個案件走到哪一步？       |

`need_repair` **沒有「已完修」**：修完了是派工單的事實（`status = 3`），不是案件的狀態。
硬塞一個值進去，同一個欄位就會表達兩件事，而報表要分開統計 ——
所以完修率一律以派工單的完工狀態計算。

`status` 另外有主管複審欄位（`upd_status_adm`），不覆蓋二篩人員 ——
「誰篩的」與「誰複審的」是兩個責任。

## 空間欄位

一律用 `geography(*, 4326)` 而非 `geometry`：距離單位就是公尺，不必自己換算投影。

| 表                                    | 型別       | 為什麼               |
| ------------------------------------- | ---------- | -------------------- |
| `patrol_cases.geom`                   | Point      | 案件是點             |
| `maintenances.geom`                   | Point      | 巡查記的是一個破壞點 |
| `work_orders.start_geom` / `end_geom` | Point      | 施工有起訖點         |
| `vehicle_tracks.geom`                 | Point      | 軌跡是一連串點       |
| `road_segments.geom`                  | LineString | 決策的單位是一段路   |
| `patrol_plans.route`                  | LineString | 應巡路線             |
| `survey_cases.geom`                   | Point      | 調查是一個量測點     |

常用空間查詢：

```sql
-- 半徑內案件（吃得到 GiST 索引）
ST_DWithin(c.geom, ST_MakePoint(:lng,:lat)::geography, :radius)

-- 軌跡總長（公尺）
ST_Length(ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at)::geography)

-- 向量圖磚：幾何要先轉到圖磚的投影(3857)
ST_AsMVTGeom(ST_Transform(c.geom::geometry, 3857), bounds.geom, 4096, 64, true)
```

`ST_AsMVTGeom` 要求幾何與範圍同座標系。不轉不會報錯，
而是回傳空圖磚，屬於不產生錯誤訊息、因此最難定位的一類問題。

## 版本化歷程的欄位

| 欄位                          | 內容                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case_type`                   | CASE_PATROL / WORK_ORDER / PROJECT / SURVEY                                                                                                                            |
| `case_id`                     | 該實體的 id                                                                                                                                                            |
| `version`                     | 同一實體內從 1 遞增，在交易裡計算                                                                                                                                      |
| `action`                      | CREATED / UPDATED / GEOCODED / STATUS_CHANGED / DISPATCHED / WORKING / REPORTED / FINISHED / ACCEPTED / RETURNED / IMAGE_UPLOADED / IMAGE_DELETED / RESTORED / DELETED |
| `snapshot_json`               | 該版本的**完整**樣貌（jsonb）                                                                                                                                          |
| `changes_json`                | 這次動到的欄位 `{ 欄位: { from, to } }`                                                                                                                                |
| `from_state` / `to_state`     | 狀態流轉                                                                                                                                                               |
| `source`                      | USER / TASK / WORKER / DEVICE                                                                                                                                          |
| `note`                        | 說明（退回原因、還原自哪一版…）                                                                                                                                        |
| `client_ip`                   | 來源 IP —— 稽核要能回答「是不是從辦公室改的」                                                                                                                          |
| `modified_by` / `modified_at` | 誰、什麼時候                                                                                                                                                           |

版本號是主鍵的一部分：兩個同時發生的變更不可能拿到同一個版本，
撞號會直接失敗，而不是靜靜覆蓋掉別人的那一版。

差異比較用**字串**而非型別比對：資料庫的 `numeric` 讀回來是 `"1.00"`，
直接比會讓每次儲存都冒出一堆假的變更，真正的變更就淹在裡面。

### 還原只還原人改得動的欄位

座標、照片路徑、外部系統 id、單號不還原 ——
那些是「這筆資料是什麼」而不是「有人改過的內容」，
還原成舊座標只會讓案件跑到地圖上的另一個位置。

還原本身也是一筆新版本（`RESTORED`），不刪任何歷程。
檢測案件不支援還原：數值來自儀器，人工只標註不改值。

## 案件來源

三種來源（`VEHICLE` / `APP` / `SIDEWALK`）在畫面上是三個分頁，資料上是同一張表 ——
它們的欄位、狀態流轉、派工流程完全一樣，拆成三張表只會讓每個查詢都要 union 三次。

## 狀態流轉

```
案件二篩   0 未審 ──▶ 2 待審 ──▶ 1 通過
                          ├──▶ 3 刪除
                          └──▶ 4 誤判（模型調校要分得出來）

案件狀態   0 待確認 ──▶ 1 觀察中 ──派工──▶ 2 已派工
                            ▲                │
                            └───── 退回 ──────┘
           （完工不改案件狀態 —— 那是派工單的事實）

派工單     0 待處理 ──▶ 1 施工中 ──▶ 2 已回報 ──驗收──▶ 3 已完工
              ▲                                    │
              └────────── 退回（填退回原因）─────────┘

報表       PENDING ──▶ RUNNING ──┬──▶ DONE
                                 └──▶ FAILED（可重排）

委託單     DRAFT ──▶ ISSUED ──▶ SURVEYING ──▶ REVIEWING ──▶ CLOSED
```

案件與派工單的狀態一起改，包在同一個交易裡 ——
僅修改單側時，現場與辦公室看到的狀態將不一致，且此類不一致不會主動顯現。

**完工前會檢查必要照片齊不齊**（依派工單類型）。
缺照片的完工單在驗收時會被退回，與其讓它一路走到驗收才發現，不如在標記完工時就擋住。

## 派工單類型與必要照片

| 類型 | 意義         | 必須帶來源案件       | 必要照片                           |
| ---- | ------------ | -------------------- | ---------------------------------- |
| `PA` | 刨除加封     | 否                   | 施工前、刨除後、面層鋪築、施工後   |
| `PB` | 路基改善     | 否（但必填取樣資訊） | 施工前、路基整治、夯實試驗、施工後 |
| `PC` | AI 車巡案件  | **是**               | 施工前、施工後                     |
| `PD` | APP 巡查案件 | **是**               | 施工前、施工後                     |

`PC` / `PD` 沒帶來源案件會出現「修了但不知道在修什麼」的單，所以在 DTO 層就擋下。

單號由系統依「標案號 + 類型 + 年月 + 流水」自動編碼（例：`DEMO01PC26080001`），
從單號就看得出是哪個標案的第幾張。
