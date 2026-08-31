# 多階段建置：前端與後端各自獨立
#
# 只有 package.json / yarn.lock 變動時才會重裝依賴；
# 改前端不會觸發後端重建，反之亦然。

# ─── 依賴層(前後端共用) ──────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

# ─── 後端建置 ────────────────────────────────────────────────────
FROM deps AS backend-build
WORKDIR /app
COPY server ./server
RUN yarn build:server

# ─── 後端執行 ────────────────────────────────────────────────────
FROM node:22-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
# 執行期不需要 devDependencies，映像檔小一半、攻擊面也少一半。
# tsconfig-paths 是例外，所以列在 dependencies —— 編譯後的 dist 仍靠它解析
# tsconfig 的路徑別名(@/ @entities/…)，少了它每個行程都會在啟動時就 MODULE_NOT_FOUND
RUN yarn install --frozen-lockfile --production --network-timeout 600000 && yarn cache clean
COPY --from=backend-build /app/dist ./dist
COPY server/register.js server/tsconfig.json ./server/
EXPOSE 3008
CMD ["node", "-r", "./server/register.js", "dist/server/server.js"]

# ─── 前端建置 ────────────────────────────────────────────────────
FROM deps AS frontend-build
WORKDIR /app
COPY index.html vite.config.mts tsconfig.json ./
COPY src ./src
RUN yarn build

# ─── 前端靜態服務 ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS frontend-server
COPY --from=frontend-build /app/build /usr/share/nginx/html
EXPOSE 80
