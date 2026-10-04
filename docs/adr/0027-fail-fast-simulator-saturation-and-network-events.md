# 0027. A fail-fast simulator, a saturation run, browser network events and a guard on dev tokens

Status: accepted, 2026-10-04

## Context

Four things in the first finished version were weaker than they looked.

- `pnpm sim` walked every seed before it printed anything about a failure, and it checked its time budget only after the loop. A convergence bug at seed 3 cost the full 5,000 seeds in CI, and an injected bug took as long as a green run.
- The load test offers a fixed 4 operations per client per second. Its "operations per second" is the offered rate the server kept up with. Read on its own it looks like a capacity figure.
- The sync client noticed a dead network only when the 10 second acknowledgement watchdog fired, so the offline indicator could lag by that long in a real browser.
- The server image runs with `NODE_ENV=production`, and the config accepted `COSCHEMA_DEV_TOKENS=1` there. `POST /dev/token` mints a valid token for anyone who can reach the port.

## Decision

- The simulator prints each failing seed and its replay command the moment it fails. `--bail` stops at the first failure. `--budget` is checked inside the loop, so a run stops at the deadline, writes how many seeds it finished (`seeds` against `requested`, and `stoppedEarly`) and exits with code 3. CI runs the 5,000 seed pass with `--bail`, and the injected bug check with `--seeds 20 --bail`, which fails in under a second.
- `bench/load/saturation.ts` repeats the load run at 4, 8, 16 and more operations per client per second, each on a fresh server and database with two windows of 5 seconds. A step counts as sustained when delivery p95 stays under 200 ms, at least 95% of the offered operations complete, every room converges, nobody is disconnected and the generator's busiest worker is under 90% event loop utilization. The result goes to `bench/results/load-saturation.json` and the README quotes both the paced run and the ramp.
- `SyncClient.networkLost()` drops the transport and goes to `waiting` at once, and `networkRestored()` reconnects without waiting for the backoff. The editor wires them to the window `offline` and `online` events through a small `NetworkEvents` interface, and ignores them while the person has switched to offline on purpose. The acknowledgement watchdog stays as the fallback for a socket that is open but dead.
- `parseConfig` reports a problem when `COSCHEMA_DEV_TOKENS=1` is combined with production unless `COSCHEMA_ALLOW_DEV_TOKENS_IN_PRODUCTION=1` is also set. Only `docker-compose.yml` sets the second flag.

## Alternatives

- Keep the simulator as it was and rely on CI timeouts: slow feedback and no seed until the end.
- Report the load number as capacity: wrong, the generator is paced.
- Poll `navigator.onLine`: the event is the same signal without the timer.
- Remove `/dev/token` from the production bundle: a bigger change, and the compose demo needs it. A second explicit flag is enough to stop an accidental deploy.

## Consequences

- The saturation ramp takes several minutes and restarts the server for each step, so it is a separate script (`pnpm bench:saturation`) and not part of CI.
- The maximum sustained rate is a lower bound when the generator is the first thing to saturate. The result file says which limit stopped the ramp.
- `online` and `offline` events are hints. A browser can report online with no route to the server, which the watchdog and the backoff still handle.
