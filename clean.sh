#!/bin/bash
#
# 停止 Demo
#
# 用法:
#   bash clean.sh                 # 停止並移除容器(保留資料)
#   bash clean.sh --purge         # 額外移除映像檔
#   bash clean.sh --wipe          # 連同資料一起刪除(不可復原)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

opts=()
for arg in "$@"; do
    case "$arg" in
        --purge) opts+=(--rmi local) ;;
        --wipe)
            # 刪資料是不可逆的，一定要人親口確認
            read -r -p "⚠️  這會刪除資料庫與影像，無法復原。輸入 yes 確認: " ans
            [ "$ans" = "yes" ] || { echo "已取消"; exit 1; }
            opts+=(--volumes)
            ;;
        -h|--help)
            sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "未知參數: $arg"; exit 1 ;;
    esac
done

docker compose down "${opts[@]}"
echo "✅ 已停止"
