# 0016. Accessibility model: roving focus, keyboard commands, a throttled live region

Status: accepted, 2026-10-03. The details that were open are settled in ADR 0023.

## Context

The whole canvas has to be keyboard operable and a polite live region that announces remote changes without flooding a screen reader. The target is WCAG 2.1 AA and a Lighthouse accessibility score of 95 or more. Collaborative canvases rarely meet either.

## Decision

Keyboard model:

- The canvas is one tab stop. Inside it, focus is roving: one node has `tabindex="0"`, the others `-1`. Tab and Shift+Tab leave the canvas. Arrow keys with Alt move focus to the nearest node in that direction. The order for sequential navigation (`N` and `P`) is reading order, top to bottom and left to right on the snapped grid.
- Arrow keys on a focused node move it by one grid step, Shift for ten steps. Each key press is one undo step, and keys held down within 400 ms merge.
- Enter opens the inline label editor, Enter again or Escape closes it.
- `C` starts a connection from the focused node, then arrow keys or `N` and `P` choose the target, Enter creates the edge, Escape cancels. `Delete` removes the focused node or edge. `Ctrl+Z` and `Ctrl+Shift+Z` undo and redo. `?` opens a shortcuts dialog. Single-character shortcuts are active only while the canvas has focus, which is what WCAG 2.1.4 (character key shortcuts) allows.
- Focus is always visible, with a two layer ring that works on any background. A focused node outside the culled window is brought into view and into the DOM first.

Live region: one visually hidden `role="status"` element (`aria-live="polite"`, `aria-atomic="true"`). An announcer service queues messages, merges runs of the same action by the same person ("Anna moved 3 nodes"), allows at most one announcement every 1.5 seconds and drops stale ones. Local actions are not announced except for results that are not visible otherwise (connection created, nothing to undo). Names come from awareness.

Not colour alone: remote cursors and selections carry the person's name and a distinct dash pattern, hidden edges are never drawn, the offline indicator has text and an icon.

`prefers-reduced-motion` turns cursor interpolation and follow-mode easing off.

## Alternatives

- CDK `LiveAnnouncer`: reliable, but it has no throttling or merging, and I need both. I write the announcer myself and keep the dependency list short.
- Making every node a tab stop: 5,000 tab stops, and culling removes most of them from the DOM anyway.
- ARIA grid or tree semantics: they describe tables and hierarchies, not free-form diagrams.

## Consequences

- The element roles (`application` on the canvas versus `group` and `img` with names) and the exact accessible names are tuned with Lighthouse and Playwright's ARIA snapshots during the accessibility work, and any change gets recorded here.
- Keyboard-only paths are covered by Playwright tests, not only by unit tests.
