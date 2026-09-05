# 多階段建置：前端與後端各自獨立
#
# 依賴層以 workspace 為單位安裝一次，前後端共用。
# 改前端不會觸發後端重建，反之亦然 —— 只有 package.json 或 yarn.lock 變動
# 才會重裝依賴。

# ─── 依賴層(整個 workspace) ──────────────────────────────────────
#
# 每個 workspace 的 package.json 都要複製進來：yarn 需要它們才解析得出
# 整棵依賴樹。只複製根目錄那份的話，workspace 的依賴會被漏掉。
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json yarn.lock ./
COPY apps/web/package.json        apps/web/
COPY apps/api/package.json        apps/api/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json             e2e/
RUN yarn install --frozen-lockfile --network-timeout 600000

# ─── 共用套件 ────────────────────────────────────────────────────
#
# 前後端都依賴它，所以先建一次給兩邊用。
FROM deps AS shared-build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
RUN yarn workspace @road-patrol/shared build

# ─── 後端建置 ────────────────────────────────────────────────────
#
# 交付出去的映像檔會落在對方的機器上，`tsc` 的產出是可讀的 JavaScript ——
# 等於把商業邏輯、查詢條件與資料表結構一起交出去。
# 建置時多一步混淆(見 scripts/protect.js)。
#
# 這不是加密，是提高抄襲成本；除錯用的映像檔傳 `--build-arg PROTECT_SOURCE=false`。
FROM shared-build AS backend-build
ARG PROTECT_SOURCE=true
WORKDIR /repo
COPY apps/api ./apps/api
COPY scripts ./scripts
RUN yarn workspace @road-patrol/api build \
 && PROTECT_SOURCE=$PROTECT_SOURCE node scripts/protect.js

# ─── 後端執行 ────────────────────────────────────────────────────
FROM node:22-alpine AS backend
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json yarn.lock ./
COPY apps/api/package.json        apps/api/
COPY packages/shared/package.json packages/shared/
# 只裝後端這個 workspace 的正式依賴。
#
# Yarn 1 沒有 `workspaces focus`，而 `--production` 在 workspace 根目錄會裝下
# **所有** workspace 的正式依賴 —— 前端的 MUI、Leaflet、Recharts 全部進來，
# 而後端一個都用不到。所以先把 workspace 清單刪到只剩後端要的兩個。
#
# tsconfig-paths 是刻意留在 dependencies 的：編譯後的 dist 仍靠它解析
# 路徑別名(@/ @entities/…)，少了它每個行程都會在啟動時就 MODULE_NOT_FOUND。
RUN node -e "const p=require('./package.json'); p.workspaces=['apps/api','packages/shared']; delete p.devDependencies; delete p.scripts; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))" \
 && yarn install --production --network-timeout 600000 \
 && yarn cache clean
COPY --from=backend-build /repo/apps/api/dist            ./apps/api/dist
COPY --from=backend-build /repo/packages/shared/dist     ./packages/shared/dist
COPY apps/api/register.js apps/api/tsconfig.json ./apps/api/
WORKDIR /repo/apps/api
EXPOSE 3008
CMD ["node", "-r", "./register.js", "dist/main/api.js"]

# ─── 前端建置 ────────────────────────────────────────────────────
FROM shared-build AS frontend-build
WORKDIR /repo
COPY apps/web ./apps/web
RUN yarn workspace @road-patrol/web build

# ─── 前端靜態服務 ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS frontend-server
COPY --from=frontend-build /repo/apps/web/build /usr/share/nginx/html
EXPOSE 80
