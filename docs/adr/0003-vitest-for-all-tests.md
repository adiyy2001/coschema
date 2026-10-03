# 0003. Vitest for every unit and integration test

Status: accepted, 2026-10-03

## Context

The working rules say Jest unless the Angular CLI default is clearly the better fit. In Angular 22 the generated project uses `@angular/build:unit-test` with Vitest and jsdom, and Karma is no longer the default. Jest 30 with `jest-preset-angular` 17 still works, but it needs an ESM transform setup.

Yjs matters here: loading it once as ESM and once as CommonJS in the same process makes it warn and breaks its `instanceof` checks. Jest's module system makes that easy to hit when workspace packages and node modules mix formats.

## Decision

Vitest 5.0.3 everywhere:

- `packages/*` and `apps/server` run under one root Vitest config with one project per package, so one command runs and covers all of them.
- `apps/editor` runs through `ng test` (the Angular builder wraps Vitest) with jsdom.
- Property tests use fast-check 4. Coverage uses `@vitest/coverage-v8` with per-folder thresholds: 90% of lines for the core logic (`packages/*`, the routing and the interaction state machine, the server's room, auth and persistence logic) and 80% for everything else.
- Integration tests are separate Vitest projects selected by file name (`*.integration.test.ts`) so `pnpm test` stays fast and needs no Docker.

## Alternatives

- Jest 30 and `jest-preset-angular`: familiar from my day job, but it means two runners if the Angular side ever moves, and more ESM friction around Yjs.
- Node's built-in test runner for the packages: no coverage thresholds per folder, no fake timers that match the rest.

## Consequences

- One mental model for all tests. The cost is that I give up Jest-specific habits (`jest.mock` becomes `vi.mock`).
- jsdom has no layout. The editor computes pointer coordinates from `getBoundingClientRect` and its own viewport math, never from `getScreenCTM`, so the tests can drive it.
