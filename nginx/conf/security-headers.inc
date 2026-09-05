# ─── 安全表頭 ────────────────────────────────────────────────────
# 抽成獨立檔案是因為 nginx 的 add_header 是**取代**而不是累加：
# 只要子 location 自己寫了任何一個 add_header，父層的全部會被丟掉。
#
# 這正是這份設定原本的漏洞 —— `location = /index.html` 為了關快取寫了
# 一行 add_header，於是每一次開啟網頁（也就是絕大多數的請求）
# 都沒有帶到任何安全表頭，而靜態資源反而有。
#
# 所以凡是自己有 add_header 的 location，都要再 include 這一份。
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
