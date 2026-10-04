# 0010. Persistence: append-only update log in PostgreSQL, compacted into a snapshot

Status: accepted, 2026-10-03

## Context

The server needs an append-only update log in PostgreSQL, periodic compaction into a snapshot, unloading of idle documents and a graceful shutdown that flushes. PostgreSQL 18.6 is the current stable major (released 2026-08-13, per postgresql.org). Version 19 is still in beta.

## Decision

Two tables, both created by plain SQL migrations applied by a small runner (a `schema_migrations` table, no migration framework):

- `doc_updates(room_id text, seq bigint generated always as identity, update bytea, created_at timestamptz default now())`, indexed on `(room_id, seq)`.
- `doc_snapshots(room_id text primary key, snapshot bytea, up_to_seq bigint, updated_at timestamptz)`.

Writes: the room collects the updates it applies, merges them with `Y.mergeUpdates` and appends one row per 50 ms window (or earlier when the batch is large). Every append is followed by an ack to the senders (ADR 0009).

Load: read the snapshot, then every update with `seq > up_to_seq`, apply them to a `Y.Doc`.

Compaction: runs when a room has more than a threshold of log rows (default 500) or bytes, and when a room unloads. One transaction takes `pg_advisory_xact_lock(hashtext(room_id))`, reads the snapshot and log up to a fixed `max(seq)`, builds a document, writes `encodeStateAsUpdate` into the snapshot, and deletes the rows up to that `seq`. Appends that arrive during compaction have a higher `seq` and are untouched.

Idle rooms: a room with no connections for 60 seconds (configurable) is flushed, compacted and removed from memory. The next join loads it again.

Shutdown: on `SIGTERM` and `SIGINT` the server stops accepting upgrades, closes sockets with code 1001, flushes every room's pending batch, closes the pool and exits 0, with a hard deadline of 10 seconds.

The store sits behind an interface with a PostgreSQL and an in-memory implementation. The in-memory one serves unit tests, the load test option and the Playwright runs.

Integration tests need PostgreSQL. A Vitest global setup starts `postgres:18.6-alpine` through the Docker CLI as `coschema-test-pg`, bound to `127.0.0.1` on a free port, and removes it afterwards. If `TEST_DATABASE_URL` is set (CI uses a service container), it uses that instead.

## Alternatives

- Store only snapshots: loses the append-only history and writes the whole document on every change.
- A single JSONB document: gives up the CRDT format and conflict-free merging at the storage layer.
- `testcontainers`: a good library, but it starts a reaper container I cannot name, and a 30 line helper does the job.
- `pg-mem` or embedded Postgres: not the real thing.

## Consequences

- One server process owns a room. Running several instances behind a load balancer would need a pub/sub layer. That is out of scope and goes into the README as a limit.
- A crash loses at most the unflushed 50 ms batch, and the clients still hold those updates because they were never acked.
