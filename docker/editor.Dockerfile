FROM node:24.21.0-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @coschema/editor build

FROM nginxinc/nginx-unprivileged:1.30.5-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/editor/dist/editor/browser /usr/share/nginx/html
EXPOSE 8080
