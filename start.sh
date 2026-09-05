#!/bin/bash
#
# 啟動 Demo
#
# 用法:
#   bash start.sh                 # 建置並啟動全部服務
#   bash start.sh --no-build      # 跳過建置，直接用現有映像檔
#   bash start.sh --infra         # 只起基礎設施(postgres/redis/minio)，給本機開發用
#   bash start.sh --seed          # 啟動後灌示範資料
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

build_opt="--build"
services=""
do_seed=false

for arg in "$@"; do
    case "$arg" in
        --no-build) build_opt="" ;;
        --infra)    services="postgres redis minio" ;;
        --seed)     do_seed=true ;;
        -h|--help)
            sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "未知參數: $arg"; exit 1 ;;
    esac
done

# .env 是所有機密的來源，缺了就不要讓服務帶著空密碼跑起來
if [ ! -f .env ]; then
    echo "❌ 找不到 .env，先執行: cp .env.example .env && vi .env"
    exit 1
fi

echo "🚀 啟動服務 ${services:-(全部)}"
# shellcheck disable=SC2086
docker compose up -d $build_opt $services

if [ "$do_seed" = true ]; then
    echo "🌱 灌入示範資料"
    yarn seed
fi

echo
docker compose ps
echo
echo "  前端      http://localhost:18080"
echo "  API       http://localhost:13008/api/health"
echo "  API 文件  http://localhost:13008/api-docs"
echo "  MinIO     http://localhost:19001"
