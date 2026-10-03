# 0009. Wire protocol, first-message JWT auth and acknowledgements

Status: accepted, 2026-10-03

## Context

The server speaks y-protocols over `ws`. Rooms need authentication with a JWT and a dev key. Browsers cannot set headers on a WebSocket, so a token has to travel in the URL, a subprotocol, a cookie or the first message. The offline indicator also needs a count of pending updates, and y-protocols has no acknowledgement for updates.

## Decision

Envelope: every binary frame starts with a `varUint` message type, encoded with lib0.

| Type | Number | Direction | Payload |
| --- | --- | --- | --- |
| sync | 0 | both | y-protocols sync message (step 1, step 2, update) |
| awareness | 1 | both | y-protocols awareness update |
| auth | 2 | both | client to server: token (`varString`). Server to client: y-protocols permission denied with a reason. |
| query awareness | 3 | client to server | asks for the current awareness states |
| ack | 4 | server to client | `{token, state vector}`: the server has persisted everything up to that vector |
| flush | 5 | client to server | a marker `token`. The server answers with an ack carrying the same token once everything applied before the marker is persisted |

Connection: `GET /rooms/:roomId` upgraded to WebSocket. The first frame must be an auth message within 5 seconds, or the socket closes with code 4401. The server verifies the token with `jose` (HS256, issuer `coschema`, audience `coschema`, 5 seconds of clock tolerance, `alg: none` rejected) and requires the `room` claim to equal the room in the path. Only after that does the server answer with sync step 1. Bad tokens never reach a room.

Claims: `sub`, `name`, `color`, `room`, `exp`. The dev key comes from `COSCHEMA_JWT_SECRET`. Outside production a documented default is used, and the server refuses to start in production without one. `POST /dev/token` mints tokens when `COSCHEMA_DEV_TOKENS=1`, and the compose file turns it on.

Acks: the client counts local transactions with a sequence number. To learn what is safe it sends a flush marker after every local update and after every handshake reply that carries local changes, and the marker's token is the sequence number it covers. The hub answers with an ack as soon as its persistence callback has completed for everything it applied before the marker. If it already has nothing outstanding, it answers at once. The ack carries the marker's token and the persisted state vector, and the client drops every pending update up to the marker's sequence number. The pending count in the UI is `localSeq - ackedSeq`. A flush with no answer for the ack timeout (10 seconds by default) makes the client drop the connection and reconnect, because a connection that silently swallows markers is not delivering updates either. A hub whose persistence callback failed stops acknowledging and reports it. After a page reload, the count is recomputed from the difference between the IndexedDB document and the last acknowledged state vector.

Awareness: the client sends its state at most every 50 ms (about 20 per second) and keeps the latest state while throttled. The hub relays awareness updates unchanged and, when a connection closes, removes only the client ids that connection controlled. There is no expiry timer: presence ends when the connection ends, which is deterministic in the simulator, and a client that goes quiet while its connection is open is simply still present. On every handshake the client bumps its own awareness clock twice before announcing itself (ADR 0019).

## Alternatives

- Token in the query string: ends up in proxy and access logs.
- Token in `Sec-WebSocket-Protocol`: works, but misuses the header and echoes the token back.
- Cookies: cross-origin complications for a demo hosted elsewhere.
- Counting pending updates without an ack: cannot distinguish "sent" from "persisted".

## Consequences

- A stock `y-websocket` client cannot connect, because of the auth frame. I own the client, so this costs nothing.
- Tokens are bearer tokens with a room claim. Permissions beyond the room token are out of scope.
- The ack message is the one custom part of the protocol. It gets its own tests.
