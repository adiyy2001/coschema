# 0018. One dev-tool licence exception: lightningcss

Status: accepted, 2026-10-03

## Context

The brief allows only permissive dependencies (MIT, Apache 2.0, BSD, ISC). `scripts/licenses.ts` enforces that over everything pnpm installed. Vite 8, which Vitest 5 and the Angular 22 build tooling run on, depends on `lightningcss`, and it is licensed MPL-2.0. MPL-2.0 is a file-level copyleft licence.

## Decision

`lightningcss` and its platform packages are on a named exception list in `scripts/licenses.ts`. The exception is tied to the exact licence, so a change of licence in a later version fails the check again.

The justification is narrow: it is a build-time dev tool pulled in by Vite, it is not part of any shipped bundle, it is not modified, and there is no way to run Vite 8 without it. The unmodified MPL-2.0 source obligations only apply when distributing the code, which this repo does not.

`CREDITS.md` lists it with its licence.

## Alternatives

- Pin Vite 7 to avoid it: Vitest 5 and Angular 22 want Vite 8.
- Drop the licence rule for dev tools: the check would then say nothing about what is allowed in.

## Consequences

- Any new exception is a new line in the script and a new entry here.
- Lighthouse stays out of `package.json` for the reason in the plan: it is avoidable, so it is run through `pnpm dlx`.
