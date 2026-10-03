# 0025. Scope cuts: what is not built and why

Status: accepted, 2026-10-04

## Context

The brief lists nine must-haves and four stretch goals (named version snapshots, comments on nodes, SVG and PNG export, a Quarkus auth service). It also says that when the scope grows, stretch goals go first and tests never do. After milestone 8 every must-have works in the production build and the quality gates are green, so this is the moment to say exactly what is missing.

## Decision

Built from the stretch list: SVG and PNG export (ADR 0024). It was the cheapest one, it needs no server change, and it is what a person actually wants out of a diagram editor.

Not built:

- Named version snapshots with restore. It needs a `doc_versions` table, endpoints, a panel and a restore that is itself a collaborative operation. The restore is the hard part: a Yjs document has no "go back to this state" for everyone, so it would be a diff applied as new edits.
- Comments on nodes. A second shared structure, its own validity rules when the node is deleted, and an accessibility story for reading and writing them.
- The Quarkus auth service. The JWT check in the sync server stays as it is, with a dev key. A Java service issuing tokens would be a separate repository's worth of work and says nothing new about collaboration.

Also not built, although the data model has room for them:

- Resize handles on nodes. `size` is in the document and the resize command is in the simulator's operation set, so concurrent resizes are covered by the convergence tests. The editor has no handles to drive it.
- Dragging the waypoints of an edge. Waypoints are stored and routed through, but there is no way to create one in the UI.
- Firefox and WebKit runs of the end-to-end suite. Playwright is configured for Chromium only. Nothing in the code is Chromium specific, and the Lighthouse and frame rate numbers are Chromium numbers.
- A manual check with a real screen reader. The keyboard path is tested in Playwright, the accessible names and roles are audited with Lighthouse (score 100) and ARIA snapshots, and nobody has listened to it with NVDA or VoiceOver.

## Alternatives

- Build comments or versions and cut something from the tests. Rejected by the brief's own rule.
- Hide the gaps. The README has a limitations section instead, and this ADR is its source.

## Consequences

- The README says what is missing in plain words.
- Each item is a self-contained piece of work that can start from the existing structure, and none of them needs a change to the wire protocol.
