# 0012. Convergence simulator: scenarios, a virtual clock and two drivers

Status: accepted, 2026-10-03

## Context

The simulator is the centerpiece of the project. It has to be deterministic, fast enough for thousands of seeds in CI, able to shrink a failure to something readable, and able to replay a failing run from a printed seed.

## Decision

A scenario is plain data: `{ seed, clients (2 to 8), steps }`. A step is a client operation, a network action or an advance of the virtual clock. Operations are create, move, drag (several moves inside one gesture), delete, connect, disconnect, edit label (a minimal diff at an index), reorder, reorder many, style, resize, undo, redo and presence. Nodes and edges are named by an index that is resolved against the client's current visible graph (modulo its size), so a step stays valid after shrinking and a step that finds nothing is a recorded no-op. Network actions are degrade (one of the profiles clean, slow, lossy, chaotic), partition, unpartition, offline, online and reconnect, each addressed to one client's link.

`runScenario(scenario)` builds one `World`: a `RoomHub` on a virtual clock, and per client a `Y.Doc`, `History`, `GraphStore`, awareness, `SyncClient` and a `SimulatedLink`. A fixed Yjs client id and document guid per client keep the bytes identical between runs. A scenario starts with a prelude (every client creates a few nodes, then connects some of them, with time to sync in between) so that the random steps have something to act on.

All randomness inside a run (ids, fractional suffixes, link jitter and drops, backoff jitter) comes from one seeded PRNG (`sfc32`, own code) split by name per client and per purpose, so the same scenario always produces the same trace. The virtual clock orders timers by `(time, insertion id)` in a heap and aborts with `VirtualClockOverflowError` after an event budget, which the runner reports as a `quiescence` failure (a livelock is a bug too). The result has a trace hash over every step, link event and settled state, so determinism itself is tested and `pnpm sim --seed 1 --verbose` prints the same hash twice.

`SimulatedLink` implements `Transport` for both ends. It models latency with jitter, reordering (an extra delay on a share of messages), duplication, loss, a partition (messages are dropped in both directions, the connection stays open, a new connection attempt hangs) and offline (live connections close, attempts fail). It lives in `@coschema/sim/link` and has no Node imports, so the demo page in M7 reuses it.

Healing: every link goes back to the clean profile, partitions and offline end, every client reconnects (a fresh handshake, as the real client does) and the virtual clock runs until it is idle. Loss is repaired by that handshake, which is what the product does after any lost connection. Duplicates and reordering are handled by Yjs itself, and the simulator makes them as nasty as it can.

Invariants after healing (the name in the failure line is in brackets):

1. Every client document and the hub document have the same state vector and encode to the same state (`identical-document`, compared as raw bytes first and as a canonical form second).
2. `deriveGraph` returns an identical graph for all clients (`identical-graph`) and the incremental `GraphStore` equals it (`store-matches-derived-graph`).
3. That graph satisfies the validity rules of ADR 0007 (`valid-graph`).
4. Replaying the log of updates the hub handed to its persistence callback into an empty document gives the hub's state (`persisted-log-replays`). This is the property the PostgreSQL log in M3 relies on.
5. Every client reports synced and has no pending updates (`clients-synced`, `no-pending-updates`).
6. Awareness: every client and the hub agree on the set of present clients (`presence-converges`).
7. No code path threw (`no-errors`) and the clock went idle (`quiescence`).

After that, one client runs an undo storm (undo until the stack is empty, settle, check) and a redo storm (redo until empty, settle, check). Undoing everything must not remove any node another client created (`undo-keeps-foreign-nodes`), and all the invariants above must hold after each storm.

Two drivers share `runScenario`:

- A fast-check property (`checkConvergence`) for shrinking. A failure prints `seed=<scenario seed>`, the fast-check runner seed, the invariants that broke, `SIM_SEED=<runner seed> pnpm test:sim` to replay it, and the shrunk scenario as JSON. `SIM_RUNS` sets the run count (40 by default, 500 in the CI job).
- A CLI, `pnpm sim --seeds 5000`, that derives a scenario from each integer seed with `fc.sample(arbitrary, { seed, numRuns: 1 })`, so the CLI and the property generate from the same arbitrary. It prints `seeds=5000 failed=0 duration=79.0s` and writes counts, duration, seeds per second, message totals, the Node version and the failing seeds to `bench/results/sim.json`. A failure prints `FAILED seed=<n>`, the broken invariants and `pnpm sim --seed <n> --verbose`, which replays the run with a readable trace and its hash. The exit code is 1 on any failure.

The simulator is tested against itself with injected faults, available on the CLI as `--inject lose-log` and `--inject zombie`: a persistence callback that silently drops one log entry, and a client that stops syncing mid run. Both must fail with a seed and a named invariant. A client that skips applying one update is not a useful bug to inject, because the state vector handshake after healing repairs it, which is the point of the handshake.

Sensitivity was also checked by hand with two mutations of production code: a graph read that shows an edge whose target is gone (222 of the first 300 seeds fail, as `quiescence` and `no-errors`), and the removal of the awareness fix of ADR 0019 (`presence-converges` fails on seed 1).

## Alternatives

- Only fast-check with a numeric seed: shrinking a seed integer tells you nothing.
- Only a seed loop: no shrinking, and failures are long traces.
- Real timers and sockets: slow, flaky and not reproducible.
- Worker threads for the seed loop: the loop is about 13 ms per seed, 5,000 seeds take about 80 seconds in one process, which fits the CI budget. Threads would add a harness for a number that is already fine.

## Consequences

- The scenario format and the operation resolver are part of the test code, and they get unit tests of their own.
- Dropped messages are only repaired by a re-handshake. The product behaves the same way (a lost WebSocket frame means a lost connection), and a periodic anti-entropy handshake is a candidate for later.
- `SimulatedLink` can deliver the close of a connection before data that was sent just ahead of it, which a real TCP connection never does. Data that is cut off is the same as a lost connection, which the handshake repairs, so no invariant depends on it.
- The simulator measures convergence after healing. It does not claim anything about the time convergence takes.
