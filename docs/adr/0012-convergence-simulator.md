# 0012. Convergence simulator: scenarios, a virtual clock and two drivers

Status: accepted, 2026-10-03

## Context

The simulator is the centerpiece of the project. It has to be deterministic, fast enough for thousands of seeds in CI, able to shrink a failure to something readable, and able to replay a failing run from a printed seed.

## Decision

A scenario is plain data: `{ seed, clients (2 to 8), steps }`. A step is either a client operation (create, move, delete, connect, edit label, undo, redo, reorder, each with indexes that are resolved against the client's current visible graph, so a step stays valid after shrinking) or a network action (deliver, drop, duplicate, delay, partition a client, heal, go offline, reconnect). `runScenario(scenario)` builds clients with `SyncClient`, a `RoomHub` and `SimulatedLink`s on a virtual clock, applies the steps, then heals and checks.

All randomness inside a run (ids, fractional suffixes, link jitter, drops) comes from one seeded PRNG (`sfc32`, own code) split per client and per link, so the same scenario always produces the same trace. A trace hash is part of the result, so determinism itself is tested.

Healing: partitions end, links stop dropping, every client reconnects (a fresh sync handshake, as the real client does) and the virtual clock runs until all queues are empty. Loss is repaired by that handshake, which is what the product does after any lost connection. Duplicates and reordering are handled by Yjs itself, and the simulator makes them as nasty as it can.

Invariants after healing:

1. Every document has the same state vector.
2. Every document encodes to the same state (`encodeStateAsUpdate` compared after normalising).
3. `deriveGraph` returns an identical graph for all clients.
4. That graph satisfies the validity rules of ADR 0007.
5. No client threw, and no undo stack holds a remote item.

Two drivers share `runScenario`:

- A fast-check property (`fc.assert` over a scenario arbitrary) for shrinking. A failure prints fast-check's seed and path, which replays with the `seed` and `path` options, and the shrunk scenario as JSON.
- A CLI, `pnpm sim --seeds 5000`, that derives a scenario from each integer seed and runs thousands of them without shrinking. A failure prints `seed=<n>` and `pnpm sim --seed <n> --verbose` replays it with a readable trace. The CLI writes seed count, client range, duration and hardware to `bench/results/sim.json`, which is where the README takes its numbers from.

CI runs the property with a moderate run count and the CLI with a large one under a time budget. A run that cannot finish its seeds in the budget fails.

The simulator is tested against itself: a test injects a deliberate bug (a client that skips applying one update) and asserts the simulator catches it and prints a seed.

## Alternatives

- Only fast-check with a numeric seed: shrinking a seed integer tells you nothing.
- Only a seed loop: no shrinking, and failures are long traces.
- Real timers and sockets: slow, flaky and not reproducible.

## Consequences

- The scenario format and the operation resolver are part of the test code, and they get unit tests of their own.
- Dropped messages are only repaired by a re-handshake. The product behaves the same way (a lost WebSocket frame means a lost connection), and a periodic anti-entropy handshake is a candidate for later.
