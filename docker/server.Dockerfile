FROM node:24.21.0-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @coschema/server build

FROM node:24.21.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/server/dist/main.mjs ./main.mjs
USER node
EXPOSE 4218
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4218/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "main.mjs"]
