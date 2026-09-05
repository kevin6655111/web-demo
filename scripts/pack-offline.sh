#!/usr/bin/env bash
#
# 離線部署包。
#
# 目標機器常常連不到外網（廠區、機房、標案指定的內網），
# 所以「到現場再 docker pull」不是可行的部署方式 —— 這支腳本把
# **映像檔本身**連同設定檔一起打成一個 tar，帶著隨身碟就能裝。
#
# 打包的是映像檔而不是原始碼：對方拿到的是可以跑的東西，
# 不是一份要在他機器上重新建置、而且建置環境不一定一樣的專案。
# 後端在建置時已經過混淆(見 scripts/protect.js)。
#
#   bash scripts/pack-offline.sh [版本號]
#
# 產出：dist-offline/road-patrol-<版本>-offline.tar.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-$(date +%Y%m%d-%H%M)}"
OUT_DIR="dist-offline"
STAGE="$OUT_DIR/road-patrol-$VERSION"

# 自建的三個 target 與所有第三方映像；版本從 compose 檔讀，不另外維護一份清單 ——
# 兩份清單遲早會有一份漏掉，而漏掉的那個在現場才會發現
THIRD_PARTY=$(grep -oP '^\s+image:\s+\K\S+' docker-compose.yml | sort -u)
OWN_IMAGES="road-patrol/api:$VERSION road-patrol/web:$VERSION"

echo "── 建置自有映像（含原始碼保護）─────────────────────"
docker build --target backend         -t "road-patrol/api:$VERSION" -f Dockerfile .
docker build --target frontend-server -t "road-patrol/web:$VERSION" -f Dockerfile .

echo
echo "── 取得第三方映像 ──────────────────────────────────"
for image in $THIRD_PARTY; do
  # 已經在本機就不重抓：離線包常常要重打好幾次，每次都拉一輪 postgres 太慢
  docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
  echo "  ✅ $image"
done

echo
echo "── 打包 ────────────────────────────────────────────"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# 全部存成一個 tar 而不是一個映像一個檔：共用的 layer 只會存一份，
# 分開存的話 node:22-alpine 那幾層會被複製好幾遍
echo "  匯出映像…（會花幾分鐘）"
# shellcheck disable=SC2086
docker save $OWN_IMAGES $THIRD_PARTY | gzip -1 > "$STAGE/images.tar.gz"

# 部署需要的設定檔。.env 不進去 —— 那是每個站台各自的機密，
# 帶著別人的 .env 上線是最容易發生的事故
cp docker-compose.yml "$STAGE/"
cp .env.example "$STAGE/"
cp -r config nginx monitoring "$STAGE/"
cp scripts/install-offline.sh "$STAGE/install.sh"
chmod +x "$STAGE/install.sh"

# compose 檔裡自建服務是 build，離線機器沒有原始碼可建 —— 換成剛存進去的映像
python3 - "$STAGE/docker-compose.yml" "$VERSION" <<'PY'
import re, sys

path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()

# build: 區塊(context/dockerfile/target)整段換成 image:；
# target 決定換成哪個映像，所以要連著 target 一起比對
def swap(match):
    target = match.group('target')
    image = 'road-patrol/web' if target == 'frontend-server' else 'road-patrol/api'
    return f"{match.group('indent')}image: {image}:{version}\n"

pattern = re.compile(
    r"(?P<indent>^[ ]+)build:\n(?:[ ]+\S.*\n)*?[ ]+target:[ ]+(?P<target>\S+)\n",
    re.MULTILINE,
)

text, count = pattern.subn(swap, text)
open(path, 'w', encoding='utf-8').write(text)
print(f"  已改寫 {count} 個服務為離線映像")
PY

cat > "$STAGE/README.txt" <<TXT
道路巡查系統 離線部署包
版本：$VERSION
打包時間：$(date '+%Y-%m-%d %H:%M:%S %Z')

安裝步驟（目標機器需已安裝 Docker 24+ 與 docker compose v2）：

  1. tar -xzf road-patrol-$VERSION-offline.tar.gz
  2. cd road-patrol-$VERSION
  3. cp .env.example .env && vi .env      ← 一定要改掉所有 change-me
  4. bash install.sh

安裝完成後：

  前端      http://<主機>:18080
  API 文件  http://<主機>:13008/api-docs
  Grafana   http://<主機>:13000

首次啟動由 api 服務跑 migration 建表；要載入示範資料，
在 install.sh 後面加 --seed。
TXT

# 校驗碼：隨身碟拷貝壞掉是真的會發生的事，而壞掉的映像檔在 docker load 時
# 才會報一個看不懂的錯
( cd "$STAGE" && sha256sum images.tar.gz docker-compose.yml > SHA256SUMS )

echo "  壓縮…"
( cd "$OUT_DIR" && tar -czf "road-patrol-$VERSION-offline.tar.gz" "road-patrol-$VERSION" )
rm -rf "$STAGE"

SIZE=$(du -h "$OUT_DIR/road-patrol-$VERSION-offline.tar.gz" | cut -f1)

echo
echo "✅ 離線包已產生"
echo "   $OUT_DIR/road-patrol-$VERSION-offline.tar.gz  ($SIZE)"
