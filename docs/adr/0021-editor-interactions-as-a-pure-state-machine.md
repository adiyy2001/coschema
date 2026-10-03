# 0021. Editor interactions as a pure state machine, with the DOM and the document at the edges

Status: accepted, 2026-10-03

## Context

The editor has to handle mouse, touch and keyboard for select, drag, marquee, connect, pan, wheel zoom and pinch, and the pointer logic is where editors collect bugs: a second pointer arriving mid-drag, a cancel in the middle of a marquee, a release outside the canvas. Testing that through a browser is slow and says little about which transition failed.

## Decision

- `reduce(state, event, env)` in `interaction/machine.ts` is a pure function that returns the next state and a list of effects. States are `idle`, `pressNode`, `dragNodes`, `pressCanvas`, `marquee`, `pan`, `connect` and `pinch`. Effects are `select`, `previewMove`, `clearPreview`, `commitMove`, `viewport`, `marquee`, `connectPreview`, `connect` and `createNode`.
- `env` carries what the machine may read: the viewport, the tool, the selection, the snap settings and four lookups (hit test, node rectangle, nodes in an area, nearest port). It does not carry the document. The `InteractionController` service builds `env` from the graph view and applies the effects: it writes to the selection signal, the viewport signal, the preview and the document commands.
- A press on a node or empty canvas is not a drag until the pointer has moved 4 px. A press on an already selected node keeps the selection until release, so a drag moves the whole group and a click collapses it. Shift or Ctrl and Cmd toggle membership.
- A drag moves the nodes in a transient preview (ADR 0014) and commits one `moveNodes` inside one `History.run`, so one drag is one undo step. Escape, pointer cancel or a second touch (which starts a pinch) discards the preview without touching the document. A second pointer of any other kind is ignored. Snapping moves the whole selection by one delta so the relative offsets survive.
- Touch: one finger on empty canvas pans, a second finger starts a pinch that uses `pinchViewport` from the geometry package, and releasing either ends it.
- Hit testing prefers ports (only the nodes that show ports are checked: selected, hovered, or part of the connect gesture), then nodes by z order and shape, then edges within 6 screen pixels of the route.
- The inline label editor is a persistent `<input>` over the node, not an SVG `foreignObject`. One `History` gesture spans an editing session, so typing is one undo step. The caret and selection are stored as Yjs relative positions, and a change that does not come from this client rewrites the input value and puts the caret back at the resolved positions.

## Alternatives

- Handling events inside components with local flags: short to write, and the order bugs show up in the e2e suite instead of in a unit test.
- A statechart library: the machine has eight states and no hierarchy, so a switch is clearer than a dependency.
- `contenteditable` or `foreignObject` for the label: both complicate relative positions and zoom. A plain input sized and placed from the viewport is enough for one line of text.

## Consequences

- The machine has a unit test per transition and is at 100% of lines. The controller, canvas and label editor are covered by component tests in jsdom that dispatch pointer events (coordinates come from `getBoundingClientRect`) and by the Playwright `@single` suite on the production build.
- The keyboard model of ADR 0016 (roving focus, arrow moves, connect by keyboard) is not in M5. M5 has the shortcuts for undo, redo, delete, Enter and F2 to edit a label, and Escape.
