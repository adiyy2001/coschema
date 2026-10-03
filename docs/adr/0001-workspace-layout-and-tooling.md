# 0001. Workspace layout: pnpm workspaces, source-exported packages, no Nx

Status: accepted, 2026-10-03

## Context

The project has two apps (the Angular editor and the sync server) and four shared libraries: the document model, the sync protocol, the simulator and the geometry code. The simulator and the protocol have to run in Node, in Vitest and inside the browser demo, so they cannot depend on either app.

I use Nx at work. It pays off on large repos with a long build graph. This one has six projects and no published artifacts.

## Decision

A pnpm workspace with `apps/*` and `packages/*`. Each package is private and exports its TypeScript source directly (`"exports": { ".": "./src/index.ts" }`). There is no build step for libraries.

I checked this on 2026-10-03 with a throwaway workspace: `ng build` and `ng test` (Angular 22.2.1), Vitest 5, tsx, esbuild and `tsc --noEmit` all resolve and compile a workspace package that exports `.ts`, with no `paths` mapping and no `baseUrl`.

Root scripts (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) fan out with `pnpm -r`. pnpm is pinned through the `packageManager` field and installed by Corepack. Build scripts of dependencies are allowed explicitly in `pnpm-workspace.yaml` (`allowBuilds`), because pnpm 12 fails the install on unapproved ones.

## Alternatives

- Nx: task caching and an affected graph. Not worth the extra configuration and plugin churn for six projects. Nx can be added later without moving files.
- `tsconfig` `paths` for the packages: works too, but every tool then needs its own alias setup.
- Building the libraries with `tsc` or ng-packagr: adds build ordering and gains nothing, since nothing is published.

## Consequences

- No incremental build cache. CI time is paid in full on every run, which is fine at this size.
- A package cannot be published as is. If one ever should be, it gets a real build then.
- All packages must share one copy of `yjs`. A check in `scripts/` fails if `pnpm why yjs` reports more than one version.
