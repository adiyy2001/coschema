# Credits

coschema is written from scratch. This file lists what it builds on. Every package installed on the CI platform (the Linux x64 resolution of `pnpm-lock.yaml`) is checked by `pnpm check:licenses`, which fails on any licence outside the list in [ADR 0018](docs/adr/0018-dev-tool-licence-exceptions.md).

## Runtime dependencies

| Package | Licence | Used for |
| --- | --- | --- |
| [Yjs](https://github.com/yjs/yjs) 13.6.33 | MIT | The CRDT behind the document, the undo manager and awareness |
| [y-protocols](https://github.com/yjs/y-protocols) 1.0.7 | MIT | Sync and awareness message formats |
| [lib0](https://github.com/dmonad/lib0) 0.2.119 | MIT | Binary encoding for the message envelope |
| [y-indexeddb](https://github.com/yjs/y-indexeddb) 9.0.12 | MIT | Offline copy of the document in the browser |
| [ws](https://github.com/websockets/ws) 8.22.0 | MIT | WebSocket server |
| [jose](https://github.com/panva/jose) 6.2.12 | MIT | JWT verification |
| [node-postgres](https://github.com/brianc/node-postgres) 8.23.1 | MIT | PostgreSQL client |
| [Angular](https://github.com/angular/angular) 22.2.1 | MIT | The editor application |
| [RxJS](https://github.com/ReactiveX/rxjs) 7.8.2 | Apache-2.0 | Required by Angular |
| [tslib](https://github.com/microsoft/tslib) 2.8.1 | 0BSD | Required by Angular |

## Development tools

| Tool | Licence | Used for |
| --- | --- | --- |
| [TypeScript](https://github.com/microsoft/TypeScript) 6.0.3 | Apache-2.0 | Type checking |
| [Vitest](https://github.com/vitest-dev/vitest) 5.0.3 and its V8 coverage provider | MIT | Unit and integration tests |
| [fast-check](https://github.com/dubzzz/fast-check) 4.10.2 | MIT | Property tests and the convergence simulator |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) 6.2.5 | Apache-2.0 | IndexedDB in unit tests |
| [jsdom](https://github.com/jsdom/jsdom) 30.1.1 | MIT | DOM in component tests |
| [Playwright](https://github.com/microsoft/playwright) 1.63.0 | Apache-2.0 | End-to-end tests, benchmarks and the demo GIF |
| [ESLint](https://github.com/eslint/eslint) 10.12.0, [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) 8.71.0, [angular-eslint](https://github.com/angular-eslint/angular-eslint) 22.5.0 | MIT | Linting |
| [Prettier](https://github.com/prettier/prettier) 3.9.9 | MIT | Formatting |
| [esbuild](https://github.com/evanw/esbuild) 0.28.2 | MIT | Server bundle |
| [tsx](https://github.com/privatenumber/tsx) 4.23.15 | MIT | Running the TypeScript scripts |
| [Angular CLI and build](https://github.com/angular/angular-cli) 22.2.1 | MIT | Production build and test runner |

## Licences outside the usual list

These come in through the build tooling. None of them is copied into a shipped bundle, and none is modified.

- [lightningcss](https://github.com/parcel-bundler/lightningcss) 1.33.0 (MPL-2.0), pulled in by Vite. [ADR 0018](docs/adr/0018-dev-tool-licence-exceptions.md) explains why it is allowed.
- [caniuse-lite](https://github.com/browserslist/caniuse-lite) 1.0.30001814 (CC-BY-4.0), the browser support data that the Angular build reads. Data from [Can I use](https://caniuse.com), attributed here as the licence asks.
- `lru-cache` and `minimatch` (BlueOak-1.0.0), `mdn-data` (CC0-1.0) and two `@csstools` packages (MIT-0) are transitive dev dependencies.

## Tools run but not installed

- [Lighthouse](https://github.com/GoogleChrome/lighthouse) 13.5.0 (Apache-2.0) runs through `pnpm dlx` in `pnpm lighthouse`. It bundles axe-core (MPL-2.0), so it is not in `package.json` and nothing of it is in this repository except the scores it printed.
- Chromium, installed by Playwright, drives the browser tests and the benchmarks.
- Docker images: `node` (MIT), `nginxinc/nginx-unprivileged` (BSD-2-Clause) and `postgres` (PostgreSQL licence). They run, they are not redistributed.
- ffmpeg 6 (LGPL or GPL, depending on the build) converts the recorded video into the demo GIF. It is a command line tool on the author's machine and not part of this repository.

## Ideas and references

- Fractional indexing for ordered items follows the idea described by Figma and implemented in the CC0 [`fractional-indexing`](https://github.com/rocicorp/fractional-indexing) package. The code in `packages/model/src/fractional-index.ts` is written from scratch and shares none of it.
- The message type numbers 0 to 3 match the ones `y-websocket` uses, so the framing is familiar. No `y-websocket` code is used ([ADR 0009](docs/adr/0009-wire-protocol-and-auth.md)).
- The seeded random generator in `packages/sim/src/prng.ts` implements published algorithms from their descriptions: `sfc32` (public domain, by Chris Doty-Humphrey), a splitmix style integer mixer for seeding and the FNV-1a hash for naming streams. No code was copied.

## Assets

The favicon, the icons and the starter diagram are drawn for this project. The editor uses the system font stack, so no font files are shipped.
