# 0011. One transport interface, one room hub, three places it runs

Status: accepted, 2026-10-03

## Context

Three things need the same sync logic: the Node server, the convergence simulator and the demo page, where two or three editors sit behind simulated links. If each had its own copy, the simulator would prove nothing about the server, and the demo would show behaviour the product does not have.

The demo page is also a recruiter's first contact. It should work on a static host without any backend.

## Decision

`packages/sync` defines:

- `Transport`: `send(bytes)`, `onMessage`, `onClose`, `close()`. Implementations: a WebSocket transport for browsers and Node, and `SimulatedLink` (in `packages/sim`) that wraps any other transport or a pair of in-memory endpoints and applies delay, jitter, reordering, duplication, loss, partitions and an offline switch, driven by an injected clock.
- `RoomHub`: owns one `Y.Doc` and one `Awareness` for a room, accepts connections as transports, runs the sync and awareness handlers, broadcasts, and reports applied updates through a callback (the server uses that for persistence and acks).
- `SyncClient`: auth, handshake, awareness throttling, acks, pending count, reconnect with exponential backoff and jitter, and a re-handshake after every reconnect.

The Node server adds the HTTP and WebSocket gateway, JWT verification and PostgreSQL around `RoomHub`. The simulator runs `RoomHub` and `SyncClient` on a virtual clock. The demo page runs `RoomHub` inside the page and connects each editor to it through its own `SimulatedLink`. A query parameter points the demo at a real server instead.

## Alternatives

- Demo against the real server only: needs a deployed backend for the live link, and a recruiter's click would depend on it being up.
- A simplified fake for the demo: shows something that is not the product.
- `BroadcastChannel` between tabs: not the topology the product has.

## Consequences

- Anything in `packages/sync` and `packages/sim/src/link` must be free of Node APIs and run in a browser.
- The simulator, the demo and the server can disagree only on the parts outside `RoomHub` and `SyncClient`: auth, persistence and the socket. Integration tests cover those.
