# 0028. The demo page as a static site on GitHub Pages

Status: accepted, 2026-10-06

## Context

ADR 0011 made the demo page independent of any backend so it could live on a static host. GitHub Pages serves the demo at the root of the custom domain `coschema.adrianturbinski.pl`, and it has no rewrite rules: a request for a path that is not a file gets `404.html`. Without the custom domain it would live under `/coschema/` on `adiyy2001.github.io`, so the editor must not depend on being at `/`. It had two links that started with `/`, the "Solo editor" link on the demo page and the path the join dialog opens for a room. A visitor should land on the demo, not on the solo sandbox.

## Decision

- A `pages` build configuration sets the base href to `/`, writes to `apps/editor/dist/pages` and swaps `start-page.ts` for `start-page.pages.ts`. In that build the empty path and unknown paths redirect to `demo`. The normal build is unchanged and still opens the sandbox at `/`.
- The sandbox is also at `solo` in both builds. The demo page links to `solo` and the join dialog opens `r/<room>`, both relative to the base href, so the same code works at the root and under a base path.
- `scripts/pages-site.ts` copies `index.html` to `404.html`, `demo.html` and `solo.html`. GitHub Pages serves `demo.html` for `/demo` with status 200, and `404.html` boots the app for any other deep link.
- `pnpm test:e2e:pages` serves the built site the way GitHub Pages does (`scripts/static-server.ts`, `startPagesServer`), opens the root, checks that two editors sync, and fails on any WebSocket or any request to another origin. It also checks a deep link, an unknown path and the solo link. CI runs it in the e2e job.
- `.github/workflows/pages.yml` runs the same test on every push to `main` and deploys the folder with `actions/upload-pages-artifact` and `actions/deploy-pages`. The custom domain is a setting of the repository's Pages site (a DNS-only `CNAME` record `coschema` pointing at `adiyy2001.github.io`), because a `CNAME` file in the artifact does nothing for a deployment from Actions.

## Alternatives

- A redirect page at the root and the app only in `404.html`: every deep link and the demo itself would answer with status 404.
- Hash routing: works on any static host, but changes every URL in the product for the sake of one deployment.
- Keep the sandbox as the start page and add a link to the demo: one more click before the part worth seeing.

## Consequences

- Rooms (`r/<room>`) on Pages have no server to talk to. They work only with `?server=` pointing at a running sync server that allows the Pages origin.
- A new top level route needs its own `.html` copy in `PAGES_ROUTES` to get status 200 for a deep link. Without it the route still works through `404.html`.
