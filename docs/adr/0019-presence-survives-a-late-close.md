# 0019. A reconnecting client outbids the removal of its old connection

Status: accepted, 2026-10-03

## Context

The convergence simulator (ADR 0012) failed `presence-converges` on its first seeds. The sequence is ordinary: a client loses its connection, reconnects, and announces itself on the new connection. The hub only notices the old connection is gone later (a partition delays the close notification, or the close simply arrives after the new handshake). When it does, it removes the awareness state of every client id the old connection controlled and writes `clock + 1` for each, so that peers drop the state. The returning client's own state has the clock it announced earlier, which is lower than that removal clock, so peers and the hub keep the removal and ignore the announcement. The client stays on screen as "gone" while it is editing. y-protocols awareness has this behaviour by design: a removal wins over an announcement with the same or a lower clock.

## Decision

On every connection open, before it announces itself, the client sets its local awareness state to itself twice. Each call raises the awareness clock by one, so the announcement carries a clock at least two above anything the client sent on the old connection, and the hub's removal (`clock + 1` of the last state the hub saw) can never beat it. The hub keeps removing only the ids that the closing connection controlled, and the control of an id moves to the connection that announced it last, so a late close of the old connection does not touch the new one.

## Alternatives

- Expiry timers on the hub, as `y-websocket` has: states vanish after 30 seconds without an update. Non-deterministic under a virtual clock and it makes a quiet client look gone.
- Make the hub ignore removals for ids that have a newer connection: correct, but it needs a connection epoch in the hub for something one clock bump solves on the client.
- A fork of y-protocols awareness: unacceptable maintenance for one line.

## Consequences

- A test in `packages/sync` pins the case: the hub processes the new handshake first and the old close second, and the state must survive. The simulator fails on seed 1 if the fix is removed.
- A removal clock is only a problem for the client's own id. Other clients' states are corrected by their own announcements.
- The cost is two extra awareness frames per reconnect, which are throttled into one.
