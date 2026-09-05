# ─── 站台共用設定 ────────────────────────────────────────────────
# 由 default.conf 的主要 port 與備援 port 兩個 server block 共同 include。
# 兩邊提供的服務完全相同 —— 分成兩份的話，改了一邊忘了另一邊，
# 而「只有走備援 port 的客戶會壞」是最難重現的那種問題。
#
# proxy 一律用 $http_host 而不是 $host：$host 會把 port 吃掉，
# 走備援 port 時後端就不知道自己是被從 https://domain:8080 存取的，
# 於是它產生的絕對網址(簽名網址、重導向)會指回沒開放的那個 port。

client_max_body_size 20m;

include /etc/nginx/conf.d/security-headers.inc;

# ─── 前端靜態檔 ──────────────────────────────────────────────
root /usr/share/nginx/html;
index index.html;

# 帶雜湊的檔名可以永久快取；index.html 絕不快取，否則改版後使用者拿到舊的入口
location /assets/ {
    include /etc/nginx/conf.d/security-headers.inc;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location = /index.html {
    include /etc/nginx/conf.d/security-headers.inc;
    add_header Cache-Control "no-store";
}

# SPA：找不到實體檔就交給前端路由
location / {
    try_files $uri $uri/ /index.html;
}

# ─── 圖層(獨立行程) ──────────────────────────────────────────
# 必須放在 /api/ 之前：nginx 的前綴比對取最長者，但順序仍影響可讀性，
# 而且圖層有自己的快取策略，混在一般 API 裡會被錯誤地當成動態內容
location /api/tiles/ {
    set $tiles http://tiles:3010;
    proxy_pass $tiles;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;

    # 圖層可能是幾 MB 的 JSON，交給 nginx 壓縮
    gzip on;
    gzip_types application/json;
}

# ─── API ─────────────────────────────────────────────────────
location /api/ {
    set $api http://api:3008;
    proxy_pass $api;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}

# ─── API 文件 ────────────────────────────────────────────────
location ~ ^/api-docs {
    set $docs http://api:3008;
    proxy_pass $docs;
    proxy_set_header Host $http_host;
}

# ─── WebSocket(即時看板) ─────────────────────────────────────
location /ws {
    set $ws http://api:3008;
    proxy_pass $ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_read_timeout 3600s;   # 看板連線是長連線，別讓 nginx 主動砍掉
}
