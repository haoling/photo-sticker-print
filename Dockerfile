# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
RUN pnpm build
RUN pnpm --filter @photo-sticker-print/server deploy --prod --legacy /out/server

FROM node:22-slim AS runtime
ENV NODE_ENV=production WEB_ROOT=/app/web
WORKDIR /app
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /out/server/package.json ./package.json
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
