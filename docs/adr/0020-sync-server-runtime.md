# 0020. Sync server runtime: ws on a bare HTTP server, one bundle, one process per room set

Status: accepted, 2026-10-03

## Context

ADR 0009 fixes the wire protocol and ADR 0010 the storage. What was left open is how the process is built and shipped: how sockets are accepted and limited, what the configuration looks like, what the container contains and how a bad client or a failing database is handled.

## Decision

- `ws` with `noServer: true` on a `node:http` server. The upgrade handler checks the `Origin` header against an allow list before the handshake completes (a missing `Origin`, as from Node clients, is allowed, `*` allows any), so a rejected page never gets a socket. Dev defaults allow the editor and demo ports on `127.0.0.1` and `localhost`. In production the list is required.
- The first frame must be an auth frame within 5 seconds, otherwise the socket closes with 4401. The token is HS256, verified with `jose`. A dev token endpoint exists only when `COSCHEMA_DEV_TOKENS` is on, and a missing secret is a startup error in production. Frames above `maxPayload` (8 MiB) close with 1009. A heartbeat ping closes connections that stop answering.
- Configuration comes from environment variables, parsed once into a typed object. Every problem is collected and printed together, so a bad deployment fails with the full list.
- A room appends a merged batch every 50 ms and acks after the write returns. When the store fails, the room closes its connections instead of acking, so clients keep the updates as pending and resend them after reconnect.
- The server is one esbuild bundle (`apps/server/dist/main.mjs`, `pg-native` left out). The image copies only that file onto `node:24.21.0-alpine` and runs as the `node` user. Inside the container the server listens on `0.0.0.0`, and compose publishes the port on `127.0.0.1` only.
- `docker-compose.yml` is named `coschema` and starts `postgres:18.6-alpine` and the server on a `coschema-net` network. The server waits for the database health check and runs the migrations on start.
- `/healthz` answers 503 while draining, `/readyz` checks the database, `/metrics` serves Prometheus text with counters and room and connection gauges.

## Alternatives

- `ws` attached directly to the HTTP server: the origin check would run after the handshake.
- A web framework for four endpoints: more surface than the routes need.
- A multi-stage image that installs production dependencies: the bundle already contains them, so the extra layer buys nothing.

## Consequences

- One process owns a room (ADR 0010). Running more instances needs sticky routing by room or a pub/sub layer.
- The bundle has no separate dependency tree to audit in the image, and the licence check keeps covering the workspace.
- The default compose secret is a local value. Anyone deploying it sets `COSCHEMA_JWT_SECRET` and `COSCHEMA_ALLOWED_ORIGINS`.
