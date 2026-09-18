#!/usr/bin/env bash
# 重啟開發用的 api 行程。
#
# 為什麼不用 `pkill -f "src/main/api.ts"`：那個樣式會match到執行它的
# 這個 shell 自己，於是腳本在殺掉 api 之前先把自己殺了(exit 144)。
# 改成問「誰在聽 3008」——那是唯一不會誤傷的識別方式。
set -euo pipefail
cd "$(dirname "$0")/.."

PID=$(ss -ltnp 2>/dev/null | grep -oP ':3008\s.*pid=\K[0-9]+' | head -1 || true)
if [ -n "$PID" ]; then
  # 連同 nodemon/npx 包裝一起收掉：只殺子行程的話上層會馬上再拉一個舊的起來
  kill -TERM -"$(ps -o pgid= "$PID" | tr -d ' ')" 2>/dev/null || kill -TERM "$PID"
  for _ in $(seq 1 20); do ss -ltn | grep -q ':3008 ' || break; sleep 0.5; done
  echo "已停止舊的 api (pid=$PID)"
fi

setsid --fork nohup yarn api > /tmp/patrol-api.log 2>&1
echo "api 啟動中，日誌：/tmp/patrol-api.log"
