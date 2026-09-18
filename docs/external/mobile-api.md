# 行動應用介接規格

給行動應用廠商。這份文件只涵蓋 App 會呼叫的端點，
其餘系統介面不在這份規格內，也不會出現在給您的互動式文件裡。

互動式文件（可直接試打）：`/api-docs/app?k=<貴司的文件金鑰>`

## 認證

用 API Key（`Authorization: Bearer rp_…`），與[車機規格](device-api.md#認證)相同，
但兩邊的金鑰權限不同：這一把只能建立鋪面調查案件。

## 上傳鋪面調查點

```
POST /api/survey/app/case
```

```bash
curl -X POST https://<主機>/api/survey/app/case \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: SV-APP-20260901-0001" \
  -H 'Content-Type: application/json' \
  -d '{
    "EXTERNAL_ID": "SV-APP-20260901-0001",
    "ORDER_ID": 1,
    "LNG": 120.6478, "LAT": 24.1636,
    "METHOD": "VISUAL",
    "ROAD_NAME": "中山路一段",
    "COUNTY": "示範市", "DISTRICT": "西屯區",
    "LANE": 2, "STATION_K": 3, "STATION_M": 250,
    "WEATHER": "晴",
    "DTYPE": "Alligator_Cracking", "DEGREE": "B",
    "DTYPE_LENGTH": 2.5, "DTYPE_WIDTH": 1.2,
    "PCI": 62.5,
    "FINDING": "龜裂範圍擴大，建議納入刨鋪"
  }'
```

### 明細（`DETAIL_ID`）是選填的

現場人員站在路邊，不一定知道這個點屬於委託單的第幾項 ——
**逼他選一個是逼他亂選**。

沒帶 `DETAIL_ID` 時，系統依 `ROAD_NAME` 比對委託單的明細；
比不到就當成臨時加測，不會擋下這筆資料。

### 面積不要傳

由 `DTYPE_LENGTH` × `DTYPE_WIDTH` 算出來。

兩邊各算一次一定會有對不上的資料（四捨五入的時機不同就夠了），
而這個數字會出現在交給業主的報表上。

### 重送是安全的

`EXTERNAL_ID` 有唯一索引。現場網路不穩時直接重送，
重複遞送回傳既有案件並帶 `DUPLICATED: true`。

### 現場照片

照片走另一支上傳端點，回傳的物件路徑再填進 `IMG` 欄位。
細節請看互動式文件的 `Mobile` 章節。

## 錯誤處理

與[車機規格](device-api.md#錯誤處理)相同。
