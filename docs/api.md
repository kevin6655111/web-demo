# API 介接

互動式文件：http://localhost:13008/api-docs（Swagger UI，可直接試打）

## 回應格式

所有端點回傳同一個信封：

```json
{ "status": true, "code": 200, "message": "", "data": {} }
```

`status` 為 `false` 代表「查無資料」或業務層警告，HTTP 狀態碼仍可能是 200。
真正的錯誤以對應的 HTTP 狀態碼回傳，且沒有 `data`。

前端因此只需要寫一次錯誤處理。

## 認證

登入後同時回傳 token 與寫入 httpOnly cookie：

```bash
curl -X POST http://localhost:13008/api/user/authenticate \
  -H 'Content-Type: application/json' \
  -d '{"COMPANY_KEY":"DEMO","ACCOUNT":"admin","PASSWORD":"Demo1234"}'
```

- **瀏覽器**用 cookie（XSS 偷不走）
- **App 與對接系統**用 `Authorization: Bearer <token>`

Token 有效 30 分鐘，可用 `PUT /auth/refresh-token` 在有效期內續期。
給第三方嵌入用 `POST /auth/temp-token`（只帶唯讀權限、5 分鐘、不寫 cookie）。

**防爆破**：同一帳號連續失敗 5 次鎖定 15 分鐘；帳號不存在與密碼錯誤回傳相同訊息且耗時相近。

## 車機端整合

### 上傳案件

```bash
curl -X POST http://localhost:13008/api/patrol/case \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: TXG-20260829-000123" \
  -H 'Content-Type: application/json' \
  -d '{
    "DT_RECORD": "2026-08-29T09:12:00.123+08:00",
    "PRJ_ID": "DEMO01",
    "CAR": "DEMO-001",
    "LNG": 120.6478, "LAT": 24.1636, "ALTITUDE": 92.4,
    "CRACK_TYPE": "Potholes", "DEGREE": "A", "CRACK_ID": 1,
    "LENGTH": 0.7, "WIDTH": 0.5, "AREA": 0.35, "DEPTH": 8,
    "IMG": "demo/case/TXG-20260829-000123.jpg",
    "IMG_DETECT": "demo/case/TXG-20260829-000123_detect.jpg",
    "SERIAL_NO": 123
  }'
```

**重送安全，三層**：

1. HTTP 的 `Idempotency-Key` + Redis `SET NX`
2. 佇列的 `jobId`
3. 資料庫的 `(DT_RECORD, IMG_DETECT, CRACK_ID)` 唯一鍵

第三層是唯一一道不依賴應用程式還活著的防線。
重複遞送回傳既有案件的 `ID` 並帶 `DUPLICATED: true`，HTTP 狀態仍是成功 ——
車機在隧道裡收不到回應就重送，這是常態，不該讓它為此寫特殊處理。

**地址是非同步補的**：剛建立的案件沒有地址列，由 worker 逆地理編碼後補上，
排程再兜底掃一次漏掉的。地址補不到不該讓案件進不來。

**破壞類型的代碼沿用判讀模型的輸出**（`Potholes`、`Cracking`、`Alligator_Cracking`…，
大小寫照抄）。在 API 這一層「整理」成大寫，代價是每次比對都要先轉換，而漏轉的地方會安靜地壞掉。

### 上傳軌跡

```bash
curl -X POST http://localhost:13008/api/fleet/track \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"DEVICE_ID":"DEV-0001","LNG":120.6478,"LAT":24.1636,
       "RECORDED_AT":"2026-08-29T09:12:00+08:00","SPEED_KPH":32.5,"GPS_HDOP":0.8}'
```

車機用 `DEVICE_ID` 認自己而不是車牌 —— 車牌會換，車機不會。

### 上傳派工單照片

```bash
curl -X POST http://localhost:13008/api/workorder/image \
  -H "Authorization: Bearer $TOKEN" \
  -F "ID=3" \
  -F "IMG_BEFORE=@before.jpg" \
  -F "IMG_AFTER=@after.jpg"
```

`multipart/form-data`，**欄位名就是照片類型**，一次可傳多種。

- 同一類型只留一張：重傳是覆寫而不是長出第二筆 —— 現場重拍是常態，
  而驗收要的是「這個階段的照片」，不是同階段的二十張。要留全部就用 `_ZIP` 類型。
- 單檔 20MB；一般類型只收 jpg/png/heic/webp，`_ZIP` 類型只收 zip。
  副檔名與 MIME 都檢查 —— 兩者都能偽造，但同時偽造比較難。
- `GET /workorder/:ID/image` 回傳已上傳的（含 5 分鐘有效的下載網址）、
  該類型要求的、以及**還缺哪些**。
- 缺必要照片時 `PUT /workorder/status` 標記完工會回 400。

### 開巡查單與轉派工

巡查單是人在現場開的，與車機自動產生的案件走不同的端點：

```bash
# RB 巡修：當場修掉了，必填 MATERIAL —— 修掉了卻沒寫用什麼修，計價時無從對帳
curl -X POST http://localhost:13008/api/maintenance \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: MT-20260905-000001" \
  -H 'Content-Type: application/json' \
  -d '{"TYPE":"RB","PRJ_ID":"DEMO01","SURVEY_DATE":"2026-09-05",
       "PERIOD":"AM","WEATHER":"晴","DTYPE":"Potholes","DEGREE":"A",
       "DTYPE_LENGTH":0.6,"DTYPE_WIDTH":0.5,
       "DISTRICT":"西屯區","ADDRESS":"臺灣大道三段99號","LNG":120.6478,"LAT":24.1789,
       "MATERIAL":"COLD","QUANTITY":2}'

# 轉派工：PD 必須帶 MAINTENANCE_ID，來源單同時轉為「已派工」
curl -X POST http://localhost:13008/api/workorder \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"TYPE":"PD","PRJ_ID":"DEMO01","MAINTENANCE_ID":181,
       "DISPATCH_DATE":"2026-09-05","WORKER_USER_ID":[4,5],"WORK_UNIT":"VENDOR",
       "DISTRICT":"西屯區","ADDRESS":"臺灣大道三段99號"}'
```

`WORKER_USER_ID` 是**陣列**：一個坑洞常是兩三個人一起去。
不帶代表不異動、帶空陣列代表清空指派 —— 兩者在 PATCH 裡是不同的意思。
沒有指派人員是合法狀態，單會停在「待處理」。

### 狀態、撤回、刪除、復原

派工單與巡查單的狀態端點除了真實狀態，還收三個**動作碼**：

| 值   | 意思 | 規則                                           |
| ---- | ---- | ---------------------------------------------- |
| `-1` | 刪除 | 派工單已回報／已完工時回 409，要先撤回         |
| `8`  | 復原 | 回到**歷程上一個不同的狀態**，不是固定回到初始 |
| `9`  | 撤回 | 退一階（派工單專有）                           |

```bash
# 撤回一階：已回報 → 施工中（因為這張單有指派人員）
curl -X PUT http://localhost:13008/api/workorder/status \
  -H "Authorization: Bearer $TOKEN" -d '{"ID":413,"STATUS":9}'

# 巡查單的狀態端點是批次的：一趟巡查會開十幾張單
curl -X PUT http://localhost:13008/api/maintenance/status \
  -H "Authorization: Bearer $TOKEN" -d '{"ID":[5,6,7],"STATUS":-1}'
```

批次端點**不整批失敗**。擋下來的那幾筆各自附上原因：

```json
{
  "status": false,
  "message": "沒有巡查單被刪除\n1 筆未刪除\n・DEMO01RB26090007 派工單 DEMO01PD26090001 尚未刪除，請先刪除派工單",
  "data": { "DONE": [], "SKIPPED": [{ "caseNum": "DEMO01RB26090007", "message": "..." }] }
}
```

訊息以 `\n` 分行，前端要用 `white-space: pre-line` 呈現。

**權限依欄位值而不同**：同一支端點，一般更新只要 `WORK_ORDER.UPDATE`，
但刪除另需 `WORK_ORDER.DELETE`、撤回與復原需 `WORK_ORDER.APPROVE`、驗收需 `WORK_ORDER.ACCEPT`。
拆成四支端點的話前端要記四個路徑，而它們的請求主體一模一樣。

## 端點分類

| 分類           | 主要端點                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| Auth           | 登入、續期、臨時 token、帳號管理                                                   |
| Role           | 角色、權限總表                                                                     |
| Core           | 代碼表、公告、圖形驗證碼                                                           |
| Orgstruct      | 使用者導覽選單                                                                     |
| Company        | 下層單位清單／建立／更新、授權開通與收回、可開通範圍                               |
| Project        | 標案查詢／詳情／新增／狀態、關聯維護（公司／車輛／工務段轄區）、工務段與行政區清單 |
| Case-Patrol    | 案件新增、查詢（20+ 條件）、詳情、狀態變更、批次狀態、多維度統計、附近查詢         |
| History        | 版本時間軸、指定版本、版本比較、還原、稽核查詢（五種實體共用）                     |
| Maintenance    | 巡查單／巡修單新增、更新、**批次狀態（含刪除與復原）**、照片、查詢                 |
| Work-Order     | 派工、更新、狀態流轉（含撤回／刪除／復原）、**照片上傳／清單／刪除**、查詢         |
| Fleet          | 車輛、軌跡上傳與查詢、軌跡統計                                                     |
| Road-Eval      | 路段清單、圖層、等級分布、重算                                                     |
| Patrol-Setting | 巡查計畫、路線圖層、覆蓋率                                                         |
| Survey         | 調查委託單、調查點                                                                 |
| Report         | 報表產製、狀態、下載、刪除                                                         |
| Dashboard      | 儀表板總覽                                                                         |
| Tiles          | GeoJSON 圖層、向量圖磚                                                             |
| Geo            | 行政區界線、案件地址自動完成                                                       |
| Location       | 門牌圖資：座標反查地址、地址正查座標、路段自動完成、涵蓋統計                       |
| Mail           | 郵件工作清單／內容／重送／刪除、測試寄送                                           |
| Push           | 推播裝置註冊／停用／清單、涵蓋統計                                                 |
| Realtime       | 線上人員、車輛位置、案件討論                                                       |
| Support        | 客服對話                                                                           |
| Task           | 排程狀態、手動觸發                                                                 |

## 圖層：GeoJSON vs 向量圖磚

|      | GeoJSON              | 向量圖磚                      |
| ---- | -------------------- | ----------------------------- |
| 端點 | `GET /tiles/case`    | `GET /tiles/case/{z}/{x}/{y}` |
| 回傳 | FeatureCollection    | `application/x-protobuf`      |
| 大小 | 全區約 490 KB        | 單格約 42 KB                  |
| 適用 | 需要在前端過濾、統計 | 案件量上千、地圖頻繁平移      |

圖磚由 PostGIS 直接產生（`ST_AsMVT`），空圖磚回 204 而不是空的 200 ——
這樣地圖函式庫才知道這一格沒東西可畫。

## WebSocket

```
ws://localhost:13008/ws?token=<JWT>
```

連線時就驗 token（WebSocket 沒有「每個請求帶憑證」的機制，握手是唯一能擋人的時機），
並依公司分房 —— 多租戶下不會把 A 公司的資料推給 B 公司。

**前端 → 後端**

| 訊息                            | 用途             |
| ------------------------------- | ---------------- |
| `subscribe` / `unsubscribe`     | 訂閱頻道         |
| `ping`                          | 心跳（每 20 秒） |
| `case.enter` / `case.leave`     | 進出案件討論串   |
| `chat.send`                     | 送出討論訊息     |
| `location.report`               | 位置回報         |
| `lock.acquire` / `lock.release` | 編輯鎖           |

**後端 → 前端**

`case.created`、`case.enriched`、`maintenance.changed`、`workorder.changed`、`report.done`、
`chat.message`、`chat.history`、`fleet.moved`、`presence.joined/left`、
`lock.taken/released`、`support.message`

頻道：`case` `maintenance` `workorder` `report` `task` `presence` `fleet` `lock` `support`

`maintenance.changed` 帶的是**一組** id 與單號（`{ ids, caseNums, state }`）：
巡查單的狀態是整批改的，逐筆推的話前端會為了同一次操作重整十幾遍。

## 錯誤碼

| 碼  | 意義                                                                       |
| --- | -------------------------------------------------------------------------- |
| 400 | 參數錯誤：欄位缺漏、型別錯誤，或傳了 DTO 沒定義的欄位                      |
| 401 | 未認證：token 缺漏、格式錯誤或已失效                                       |
| 403 | 權限不足                                                                   |
| 404 | 找不到資源，或資源不屬於你的公司                                           |
| 409 | 衝突：冪等鍵用於不同內容、重複派工、狀態不允許（已回報的單要先撤回才能刪） |
| 429 | 流量限制                                                                   |
