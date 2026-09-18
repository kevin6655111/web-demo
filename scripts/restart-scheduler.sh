#!/usr/bin/env bash
# 重啟開發用的 scheduler 行程。
#
# 為什麼要**按 PGID 收掉**：`yarn scheduler` 底下是 npm exec → sh → node 三層，
# 只殺最下面那個 node 的話，上層的 npm 會立刻再拉一個**舊程式碼**的起來，
# 看起來像是重啟失敗，實際上是重啟成功之後又被復活。
#
# 排程只能有一份在跑(靠 Redis 鎖)，多起來的那一份會搶到鎖卻跑舊的邏輯。
set -euo pipefail
cd "$(dirname "$0")/.."

for PGID in $(ps -eo pgid,args | grep "[s]cheduler.ts" | awk '{print $1}' | sort -u); do
  kill -TERM -"$PGID" 2>/dev/null || true
done
for _ in $(seq 1 20); do ps -eo args | grep -q "[s]cheduler.ts" || break; sleep 0.5; done
ps -eo args | grep -q "[s]cheduler.ts" && { echo "舊行程沒收乾淨"; exit 1; }

RUN_MIGRATIONS=false setsid --fork nohup yarn scheduler > /tmp/patrol-scheduler.log 2>&1
echo "scheduler 啟動中，日誌：/tmp/patrol-scheduler.log"
