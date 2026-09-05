#!/usr/bin/env bash
#
# 離線包的安裝腳本（在目標機器上執行）。
#
#   bash install.sh          只啟動，不載入示範資料
#   bash install.sh --seed   啟動後載入示範資料
#
set -euo pipefail

cd "$(dirname "$0")"

echo "── 檢查環境 ────────────────────────────────────────"
command -v docker >/dev/null || { echo "❌ 找不到 docker"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ 需要 docker compose v2"; exit 1; }

# .env 先檢查再做任何事：跑到一半才發現密碼沒改，前面載入的映像就白花時間了
[ -f .env ] || { echo "❌ 找不到 .env，請先 cp .env.example .env 並修改內容"; exit 1; }

if grep -q 'change-me' .env; then
  echo "❌ .env 裡還有 change-me 的預設值 —— 那些是密碼與金鑰，一定要改掉："
  grep -n 'change-me' .env
  exit 1
fi

echo "── 驗證檔案完整性 ──────────────────────────────────"
# 隨身碟拷貝壞掉是真的會發生的事，而壞掉的映像在 docker load 時只會噴一個看不懂的錯
sha256sum -c SHA256SUMS

echo
echo "── 載入映像檔（會花幾分鐘）─────────────────────────"
gunzip -c images.tar.gz | docker load

echo
echo "── 啟動 ────────────────────────────────────────────"
docker compose up -d

echo
echo "── 等待 API 就緒 ───────────────────────────────────"
# 等到真的起來，而不是睡固定秒數 —— 第一次啟動要跑 migration，慢很多
for i in $(seq 1 60); do
  if curl -sf http://localhost:13008/api/health >/dev/null 2>&1; then
    echo "  ✅ API 已就緒"
    break
  fi
  [ "$i" = "60" ] && { echo "  ❌ API 逾時未就緒，請看 docker compose logs api"; exit 1; }
  sleep 5
done

if [ "${1:-}" = "--seed" ]; then
  echo
  echo "── 載入示範資料 ────────────────────────────────────"
  docker compose exec -T api node -r ./register.js dist/scripts/seed.js
fi

echo
echo "✅ 安裝完成"
echo "   前端      http://localhost:18080"
echo "   API 文件  http://localhost:13008/api-docs"
echo "   Grafana   http://localhost:13000"
