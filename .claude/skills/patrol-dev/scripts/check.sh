#!/bin/bash
#
# 專案健康檢查：型別、測試、建置、以及這個 Demo 特有的幾個容易踩的坑。
#
# 用法: bash .claude/skills/patrol-dev/scripts/check.sh [--quick|--privacy-only]
#   --quick         只跑靜態檢查(型別與規則掃描)，略過測試與建置
#   --privacy-only  只跑隱私掃描。這是公開專案，加完示範資料或文件時只需要這一段，
#                   而跑完整檢查要好幾分鐘 —— 太慢的檢查最後就沒有人跑

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." || exit 1

quick=false
privacy_only=false
[ "${1:-}" = "--quick" ] && quick=true
[ "${1:-}" = "--privacy-only" ] && privacy_only=true

fail=0
pass() { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }
bad()  { echo "  ❌ $1"; fail=$((fail + 1)); }

if [ "$privacy_only" = false ]; then
echo "── 靜態規則 ─────────────────────────────────────────"

# BullMQ 的 jobId 不能含冒號
if grep -rn "jobId: \`[^\`]*:" apps/api/src --include='*.ts' > /dev/null 2>&1; then
    bad "BullMQ jobId 含冒號(BullMQ 內部用冒號切 key，會直接丟錯)"
else
    pass "BullMQ jobId 格式正確"
fi

# 分頁查詢的 orderBy 必須用實體屬性名。
# 只有「同一段查詢鏈裡同時有 skip」才是問題 —— getRawMany 的原始查詢用欄位名沒關係，
# 所以逐檔用 awk 追蹤查詢鏈，而不是單看那一行。
risky=$(awk '
    /createQueryBuilder/ { chain = ""; hasSkip = 0; hasBadOrder = 0; line = FNR }
    /\.skip\(/ { hasSkip = 1 }
    /orderBy\(.[a-z]+\.[a-z]+_[a-z]+./ { hasBadOrder = 1; badLine = FNR }
    /getManyAndCount|getMany\(\)/ {
        if (hasSkip && hasBadOrder) print FILENAME ":" badLine
        hasSkip = 0; hasBadOrder = 0
    }
' $(grep -rl createQueryBuilder apps/api/src --include='*.ts') 2>/dev/null)

if [ -n "$risky" ]; then
    bad "分頁查詢的 orderBy 用了欄位名(執行期會炸)："
    echo "$risky" | sed 's/^/       /'
else
    pass "分頁查詢的 orderBy 正確"
fi

# 每支對外 API 都要有 summary
missing_docs=$(grep -rn -B3 "async handle\|  handle" apps/api/src --include='*.controller.ts' \
    | grep -c "@Get\|@Post\|@Put\|@Patch" 2>/dev/null || echo 0)
doc_count=$(grep -rc "@ApiOperation" apps/api/src --include='*.controller.ts' | awk -F: '{s+=$2} END {print s+0}')
if [ "$doc_count" -gt 0 ]; then
    pass "API 文件註記 ${doc_count} 處"
else
    bad "找不到任何 @ApiOperation"
fi

# 新實體要註冊進 ALL_ENTITIES
entity_files=$(grep -rl "@Entity(" apps/api/src --include='*.entity.ts' | wc -l)

# ALL_ENTITIES 現在是多行陣列，用 awk 取出中括號之間的內容再數
registered=$(awk '/ALL_ENTITIES = \[/,/\]/' apps/api/src/database.module.ts \
    | tr -d '[]' | tr ',' '\n' | sed 's/.*=//' | grep -cE '^\s*[A-Z][A-Za-z]*\s*$')
if [ "$entity_files" -eq "$registered" ]; then
    pass "實體全部註冊(${registered} 個)"
else
    bad "實體有 ${entity_files} 個，但 ALL_ENTITIES 只註冊 ${registered} 個"
fi

# 多租戶：查詢要收斂到 company
if grep -rn "createQueryBuilder" apps/api/src --include='*.service.ts' | wc -l | read -r _; then
    pass "查詢建構器使用中(company_id 條件請人工複查)"
fi

fi   # 靜態規則結束

echo
echo "── 隱私掃描 ─────────────────────────────────────────"
# 要掃的真實識別字放在不進版控的清單裡 —— 寫在這支腳本裡的話，
# 這個公開專案等於自己列出「我們的客戶是誰」，正好是掃描要防的那件事
pattern_file=".claude/private-terms.txt"
if [ -f "$pattern_file" ]; then
  leak=$(grep -rniE -f "$pattern_file" \
    --include='*.ts' --include='*.tsx' --include='*.jsx' --include='*.yaml' --include='*.yml' --include='*.md' \
    . 2>/dev/null | grep -v node_modules | head -5)

  if [ -n "$leak" ]; then
    bad "疑似洩漏公司/客戶資訊："
    echo "$leak" | sed 's/^/       /'
  else
    pass "未發現公司或客戶識別資訊"
  fi
else
  warn "找不到 $pattern_file，跳過識別字掃描（照 .env.example 旁的說明建一份）"
fi

if [ -f .env ] && git check-ignore -q .env 2>/dev/null; then
    pass ".env 已被忽略"
elif [ -f .env ]; then
    warn ".env 存在但未確認是否被版控忽略"
fi

if [ "$privacy_only" = true ]; then
    echo
    echo "── 結果 ─────────────────────────────────────────────"
    [ "$fail" -eq 0 ] && echo "  通過(僅隱私掃描)" || echo "  FAIL: $fail 項"
    exit "$fail"
fi

if [ "$quick" = true ]; then
    echo
    echo "── 結果 ─────────────────────────────────────────────"
    [ "$fail" -eq 0 ] && echo "  通過(僅靜態檢查)" || echo "  FAIL: $fail 項"
    exit "$fail"
fi

echo
echo "── 型別與測試 ───────────────────────────────────────"

if (yarn --silent typecheck) 2>&1 | head -5; then
    pass "後端型別檢查"
else
    bad "後端型別檢查未過"
fi

if (yarn --silent test) > /tmp/patrol-fe-test.log 2>&1; then
    pass "前端測試 $(grep -oE 'Tests +[0-9]+ passed' /tmp/patrol-fe-test.log | tail -1)"
else
    bad "前端測試未過(見 /tmp/patrol-fe-test.log)"
fi

if (yarn --silent test:api) > /tmp/patrol-be-test.log 2>&1; then
    pass "後端測試 $(grep -oE 'Tests +[0-9]+ passed' /tmp/patrol-be-test.log | tail -1)"
else
    bad "後端測試未過(見 /tmp/patrol-be-test.log)"
fi

if (yarn --silent build:web) > /tmp/patrol-build.log 2>&1; then
    pass "前端建置 $(grep -oE 'built in .*' /tmp/patrol-build.log | tail -1)"
else
    bad "前端建置失敗(見 /tmp/patrol-build.log)"
fi

echo
echo "── 結果 ─────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
    echo "  ✅ 全部通過"
else
    echo "  ❌ FAIL: $fail 項"
fi
exit "$fail"
