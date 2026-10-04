# 0026. Where the README numbers, the badges and the demo GIF come from

Status: accepted, 2026-10-04

## Context

Every number in the README has to come from a script in the repo, and the demo GIF is recorded with Playwright and converted with ffmpeg. A README written by hand drifts from the measurements the day after it is written, and a GIF recorded by hand cannot be reproduced.

## Decision

- `pnpm report` reads `bench/results/*.json` and prints the hardware and every table the README quotes (simulator, latency, panning, load and saturation, document size, routing, Lighthouse). The README numbers are copied from that output after a full run of the benchmarks on one machine, and the hardware lines are copied with them. `scripts/test/report.test.ts` pins the formatting.
- The JSON files stay in git. Each one carries the date, the Node version and, where it applies, the CPU, the core count, the memory, the OS and the browser it was measured on, so a reader can check a number against a file. They carry no git revision on purpose: the repo history is the record of when a file changed.
- `pnpm demo:gif` builds the editor, serves it from a static server, records the `/demo` page with Playwright's video recorder and converts the video with a two pass ffmpeg palette (`palettegen`, then `paletteuse`) into `docs/media/demo.gif`. The script fails when the file is larger than 8 MiB. The storyboard is in `bench/demo-gif/main.ts`: take one editor offline, edit on both sides, bring it back and watch the two copies merge, then move the pointer in both editors to show the cursors, and turn on follow mode. The recorder draws a dot at the real pointer position, because headless video does not include the mouse.
- `pnpm coverage:badge` sums the covered and total lines of the two coverage summaries (the packages and server, and the editor) and writes `docs/media/coverage.svg`. The percentage is rounded down. It is a committed file that is regenerated after `pnpm test:coverage`, not a live badge.
- The CI badge points at the workflow file and the licence badge is static.

## Alternatives

- Codecov or Coveralls for the coverage badge: live, but needs an account and a token, and the number would come from a service instead of a script in the repo.
- A shields.io endpoint badge fed from a gist: the same problem plus a secret.
- Hand-picked README numbers with a note on how to reproduce them: it is exactly the drift this decision avoids.
- A screen recording tool for the GIF: not reproducible, and the cursor and window chrome would differ from run to run.

## Consequences

- A change that moves a benchmark means rerunning the benchmark, `pnpm report`, and editing the README. Nothing checks that the README was updated, so it stays a review habit.
- The coverage badge can go stale between runs of the coverage command. The README states the figures it quotes from the same summaries.
- A GIF recorded in headless Chromium under WSL2 shows the frame rate of that run, so its timing is not a measurement and the README does not use it as one.
