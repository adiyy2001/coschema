# 0004. Yjs 13 and a sync server written against y-protocols

Status: accepted, 2026-10-03

## Context

The server has to speak y-protocols directly, without Hocuspocus or the `y-websocket` server package, to show that the protocol is understood. The registry shows Yjs 13.6.33 as `latest` (published 2026-09-23). Yjs 14 only exists as a beta tag (`14.0.0-16`). y-protocols is at 1.0.7 and y-indexeddb at 9.0.12, and both peer on `yjs ^13`.

## Decision

- Yjs 13.6.33, y-protocols 1.0.7, lib0 0.2.119, y-indexeddb 9.0.12, ws 8.22.0.
- The server uses `y-protocols/sync` and `y-protocols/awareness` for the actual protocol, framed by my own message envelope (see ADR 0009). I do not reimplement the binary sync format: that is Yjs's format, and reimplementing it would add risk and no insight.
- The message type numbers match `y-websocket` for the shared ones (sync 0, awareness 1, auth 2, query awareness 3), and one custom type (ack, 4) is added.
- Everything that is not transport lives in `packages/sync` so the same code runs in the Node server, in the convergence simulator and in the in-browser demo hub (ADR 0011).

## Alternatives

- Hocuspocus or `y-websocket`: faster to wire up, and ruled out because the point is to show the protocol.
- Yjs 14 beta: not stable, and its peers do not match y-protocols or y-indexeddb yet.
- Automerge or Loro: both fine CRDTs. Yjs has the mature undo manager and awareness protocol this project needs.

## Consequences

- Yjs state includes tombstones for deleted items. Compaction (ADR 0010) shrinks the log, but a Yjs document never forgets which client ids existed.
- Moving to Yjs 14 later is a deliberate migration, not a version bump.
