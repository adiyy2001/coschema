# 0013. Playwright for end-to-end tests, not Cypress

Status: accepted, 2026-10-03

## Context

My default for end-to-end tests is Cypress. This project is the exception. The core end-to-end claims are about two people at once: user A's edit shows up for user B within 200 ms, and edits made offline merge after reconnect.

Cypress drives one browser instance, and a test runs inside it. It can switch origins with `cy.origin`, but it cannot run two independent sessions side by side in one test.

## Decision

Playwright 1.63.0 (`@playwright/test`), with several `BrowserContext`s per test, one per simulated user. The same tool records the demo GIF frames and the screenshots used for visual checks.

Useful pieces:

- Separate contexts have separate IndexedDB, so offline persistence is tested the way a second person would experience it.
- `page.routeWebSocket` and the editor's own offline switch cover connection loss. Chromium's network emulation does not reliably cut an established WebSocket, so tests do not depend on `context.setOffline` alone.
- Pinch zoom is driven with CDP touch events, since Playwright has no pinch helper.
- Latency checks read timestamps from both pages (`Date.now()` on one machine) and assert on the p95 of many edits, not on a single run.
- Browsers: the Playwright-managed Chromium locally and in CI. The machine's Google Chrome is the fallback through `channel: 'chrome'`.

## Alternatives

- Cypress with two spec runs coordinated through a server: fragile and slow, and it would not test what the user sees.
- Selenium or WebdriverIO: no advantage here.

## Consequences

- Two E2E frameworks never appear in the same repo. Unit and component tests stay in Vitest.
- E2E runs against the production build served statically, with the real server and the in-memory or PostgreSQL store.
