# 0023. Accessibility and the demo page: how focus, announcements and the in-page room work

Status: accepted, 2026-10-04

## Context

ADR 0016 set the keyboard model and the live region on paper. Building them raised five questions: how focus relates to selection, how to name the person behind a remote change without a protocol change, what the announcer does with a burst of edits, how a page with several canvases keeps its element ids apart, and what the demo page runs against.

## Decision

Focus and selection. Focus follows selection and selection follows focus. Focusing a node selects it, selecting a single node or edge elsewhere (a click, undo) moves the roving focus to it. The node with `tabindex="0"` is the tab stop. The canvas surface itself is a tab stop only when no node can take it (an empty diagram, or the minimal detail level where nodes are not rendered). A focused node or edge is added to the rendered list even when culling would drop it, and the view pans to reveal it. At the minimal detail level the reveal zooms to 100% first, because nothing can be seen or read below the label threshold. When the focused item disappears (undo of a connection, a remote delete) focus moves to the last tab stop node, or to the surface if there is none, so keystrokes never land on the page body.

Keys. The logic is a pure function from mode, key and a small environment to a list of effects (`a11y/keyboard-model.ts`), in the same style as ADR 0021, and the controller only applies the effects. Arrow keys move the focused node by one grid step, Shift by ten, and presses that repeat within 400 ms are merged into one undo step (`MoveBurst` wraps them in a history gesture). Alt with an arrow goes to the nearest node in that direction, scored with the cross axis counted twice so that a node straight to the right beats one that is closer but far off the row. `N` and `P` walk the nodes in reading order (rows of 96 world units, left to right) and then the edges. In connect mode, arrow keys and `N` and `P` choose the target, the preview edge is drawn by the same overlay as a mouse drag, Enter commits and Escape cancels. A toolbar button adds a node in the middle of the view, so a keyboard user can start a diagram without the mouse tools.

Names. A node is `role="group"` with `aria-roledescription="diagram node"` and the name "Pump A, rectangle". The label text inside the SVG is `aria-hidden`, so it is not read twice. An edge is a group named "Connection from Pump A to Pressure?". The surface is `role="application"` with a description that lists the keys. Buttons whose visible text is only a number or a name carry labels that contain that text (the zoom button reads "Zoom 70%, reset to 100%"), and the initials in the people badges are drawn with a pseudo element, so the visible text of those buttons is the name alone. Both came from the Lighthouse audit `label-content-name-mismatch`.

Who did it. `GraphStore` listeners now get the change as well as the delta: `origin`, `local`, and `authors`. The authors are the client ids whose clock moved between the transaction's `beforeState` and `afterState`, so creations, moves and label edits are attributed exactly and no protocol field is needed. A deletion leaves no author in the state vector, so it is attributed to the only remote person present, or to "Someone" when there are several. Presence maps a client id to a name from awareness. The delta also carries the previous node records, which is how "moved" and "renamed" can name the old label.

The announcer. A remote change enters the announcer as a note. Notes settle for 250 ms so that one drag becomes one phrase, runs by the same person and the same kind merge ("Anna moved 3 nodes"), a deletion replaces earlier notes about the same node, at most three phrases are spoken before the rest is summarised as a count, one message is spoken every 1.5 seconds at most, and a note older than 10 seconds is dropped. Repeating the same text alternates a trailing non-breaking space, because a live region that receives an identical string says nothing. The initial sync is never announced: the narrator arms only after the first sync completes. Local actions are announced only when the result is not otherwise visible (connected, deleted, undone, nothing to undo).

Several canvases on one page. The demo shows two or three canvases, so the SVG marker, grid pattern and hint element ids are generated per canvas (`CanvasIds`), not fixed strings.

Demo page. `/demo` creates a `RoomHub` in the page, seeds its document with the starter diagram, and gives each editor its own `DocumentSession`, `Collaboration` and a `SimulatedLink` from `@coschema/sim/link`. The editor code is the one used by `/r/:room`. Only the injection tokens differ: the transport is the link's `connect`, the token is fixed, persistence is off (a reload starts clean), and the identity storage is a memory store holding a fixed person per pane. The per-link controls (latency, jitter, loss, offline) call `SimulatedLink.configure` and `setOffline`. In flight is computed from the link counters as sent plus duplicated minus delivered minus every kind of drop. "Make a mess" takes every link offline, applies the same three kinds of edit on every side (move the first node by id, rename the second, add a node), then brings the links back after 1.8 seconds. The two sides edit the same two nodes, so there is always a real conflict to merge. `?server=` makes the link's server end a bridge to a real WebSocket, so the same page can drive the real server through the simulated network. `?panes=3` adds a third editor.

Reduced motion and skip link. A global rule shortens animations and transitions under `prefers-reduced-motion`, and cursor interpolation already snaps (ADR 0022). A skip link at the top of every page moves focus to `main#main` with a click handler, not a hash navigation, so it does not collide with the router. Route titles come from the router and a `TitleStrategy` that appends the product name.

## Alternatives

- Focus and selection as two independent states, with Space to select. It matches some grid widgets, but it doubles the number of keys to learn and a screen reader user would hear a different thing from what the screen shows.
- Announce every remote change as it arrives. A drag produces dozens of changes per second, which a screen reader cannot speak.
- Put the author in the document for every change. It needs a schema change and costs bytes per edit, and the state vector already holds the answer.
- Run the demo against a mock transport written for it. The simulated link is the one the property tests already use, so the demo shows the real behaviour and costs no extra code.

## Consequences

- A deletion by one of several remote people is announced as "Someone deleted ...". A delete does not leave a client id behind, and the document does not store one for it.
- The visible text of the toolbar status and the connection indicator is not a live region, only the `role="status"` element speaks.
- The Lighthouse accessibility audit is a script (`pnpm lighthouse`), and its scores for `/`, `/r/test` and `/demo` on desktop and mobile settings are written to `bench/results/lighthouse.json`. A score alone does not prove the canvas is usable, so the Playwright `@a11y` group walks the keyboard path (focus, move, edit a label, connect, undo, delete, shortcuts dialog) and a remote move announcement.
- Playwright runs Chromium only. Firefox and WebKit runs are still open.
