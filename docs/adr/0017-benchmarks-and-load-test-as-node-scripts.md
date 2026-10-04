# 0017. Benchmarks and the load test are Node scripts in `bench/`

Status: accepted, 2026-10-03

## Context

The project needs a load test (50 rooms with 10 clients each, operations per second and p95 latency), a 60 fps panning measurement with 5,000 nodes, a p95 for local edit to remote render, and the encoded document size before and after compaction. Every number in the README has to come from a script in the repo that prints the hardware it ran on. k6 is not installed on this machine and would have to run from its Docker image.

## Decision

All of them are TypeScript scripts under `bench/`, run with tsx:

- `bench/load`: starts the real server (PostgreSQL store through the test database helper, or the in-memory store with a flag), opens 50 rooms with 10 `SyncClient`s each, spread over worker threads of one generator process, drives random operations at a fixed pace (4 per client per second by default) for a fixed duration and reports the completed operations per second, p50, p95 and p99 latency from one client's write to another client's observer, plus server CPU and RSS and the event loop utilization of the busiest generator thread. The paced run measures latency at an offered load, not capacity. `bench/load/saturation.ts` finds the capacity: it repeats the run at 4, 8, 16 and more operations per client per second on a fresh server and database, and stops at the first step where delivery p95 passes 200 ms, fewer than 95% of the offered operations complete, a room fails to converge, a client is dropped or the generator itself passes 90% event loop utilization. The last step that passed is the reported maximum sustained rate.
- `bench/latency`: Playwright, two contexts, N edits, p50 and p95 from the edit to the pixel on the other side.
- `bench/pan`: Playwright, a document with 5,000 nodes, scripted pan and zoom gestures, frame times from `requestAnimationFrame`, reported as fps and the share of frames over 16.7 ms.
- `bench/size`: builds documents of increasing size, encodes them, compacts through the real store and prints bytes before and after.
- `bench/geometry`: routing and culling timings.

Each script writes JSON to `bench/results/` with a timestamp, the CPU model, core count, RAM, OS, Node version and, where relevant, the browser name and version. The JSON files are committed, so the README quotes files that exist in the repo.

## Alternatives

- k6: speaks WebSocket, but the client has to speak y-protocols, so I would bundle the Yjs client into k6's runtime and still measure from outside the page. A Node harness reuses the real `SyncClient`.
- Ad hoc timing in tests: asserts a threshold, does not report a number.

## Consequences

- Numbers from a laptop under WSL2 with other jobs running are noisy. Scripts run each measurement several times, report the spread and say so in the output.
- Load results describe one Node process on one machine. The README states that and does not extrapolate.
- The first version ran all 500 clients on one thread. The generator reached 108% of a core and a p99 event loop delay of 43 ms, so the reported latency was mostly the generator waiting for itself. The clients now live in four worker threads that each own whole rooms, and the report carries the busiest worker's event loop utilization. The committed result files record that utilization next to the server's CPU, so a run where the generator is the bottleneck shows up as such. The saturation script refuses to count a step as sustained when the generator is above 90%.
