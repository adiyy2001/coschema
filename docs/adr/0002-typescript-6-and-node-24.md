# 0002. TypeScript 6.0, Node 24 LTS and zoneless Angular 22

Status: accepted, 2026-10-03

## Context

I want the latest stable version of every tool. On the npm registry the `latest` tag of `typescript` is 7.0.2. Angular 22.2.1 declares `"typescript": ">=6.0 <6.1"` as a peer of both `@angular/build` and `@angular/compiler-cli`, and typescript-eslint 8.71.0 declares `<6.1.0`. Angular also declares `node: ^22.22.3 || ^24.15.0 || >=26.0.0`, and the CLI refuses to run on older Node. The machine had Node 24.13.0.

## Decision

- TypeScript 6.0.3 for the whole repo, one version everywhere.
- Node 24.21.0 (the current 24.x LTS, "Krypton"), installed next to the older versions with nvm. `.nvmrc` and `engines` say `>=24.15.0`. Node 26 is a Current release and not an LTS yet.
- Angular 22.2.1 with the defaults of that version: no zone.js, zoneless change detection, standalone components, `OnPush` as the default strategy. Components still declare `changeDetection: ChangeDetectionStrategy.OnPush` explicitly so the intent survives a change of default, unless the Angular ESLint rules flag it as redundant.
- Strict compiler options plus `noUncheckedIndexedAccess`, `noImplicitOverride` and `exactOptionalPropertyTypes`. TypeScript 6 defaults `types` to an empty list, so each tsconfig lists what it needs (`node`, `vitest/globals`).

## Alternatives

- TypeScript 7 for the non-Angular packages: two compilers in one repo, with different diagnostics, and no gain that matters for a project this size.
- Staying on Node 24.13: the Angular CLI fails at startup.

## Consequences

- When Angular widens its TypeScript range, bump TypeScript in one commit.
- Every contributor and every CI job must use Node 24.15 or newer. CI reads `.nvmrc`.
