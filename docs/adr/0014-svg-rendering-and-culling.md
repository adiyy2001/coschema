# 0014. SVG rendering with one world transform and grid-based culling

Status: accepted, 2026-10-03

## Context

The brief requires an own SVG renderer, no diagram library, and 60 fps panning with 5,000 nodes. The SVG DOM gets slow at a few thousand elements with layout and style work, so the number of elements in the DOM has to stay small, and panning must not touch most of them.

## Decision

- Three layers inside one `<svg>`: edges, nodes, and an overlay (selection, marquee, connection preview, remote cursors, remote selections, viewport indicators). All of them live in a single world `<g>` whose `transform` is the viewport (pan and zoom). Panning changes one attribute.
- A uniform spatial grid over node bounds (cell size 512 world units) in `packages/geometry`. The visible node set is the set of nodes in the cells that intersect the viewport plus a margin of one cell.
- The visible cell window is a `computed` signal with a custom equality function, so while the pan stays inside the same window nothing downstream recomputes. `@for` tracks by node id. Each node is a small component with an attribute selector (`<g cs-node>`), signal inputs and `OnPush`.
- Edges are culled with their routed bounding box, and routing is cached (ADR 0015).
- Below a zoom threshold labels are not rendered, and below a second one nodes draw as plain rectangles.
- The Yjs document feeds the UI through an incremental graph store: an observer collects the node and edge ids that changed in a transaction, and the store recomputes only those. Updates are batched to one per animation frame.
- The first deliverable of the editor milestone is a 5,000 node benchmark page. If panning in headless Chrome does not hold 60 fps there, the renderer changes before any interaction code is written.

## Alternatives

- Canvas or WebGL: faster at scale, but the brief asks for SVG and SVG is accessible by construction (focusable elements, ARIA).
- `content-visibility` and CSS containment alone: helps layout, does not cut the number of Angular views.
- A virtual scroll component: designed for lists, not a 2D plane.

## Consequences

- Elements outside the window do not exist in the DOM, so find-in-page and screen reader browse mode do not see them. The keyboard model (ADR 0016) works from the store, not from the DOM, and brings the focused node into view.
- The benchmark numbers (frame times, hardware, browser) come from `bench/` and are the only source for the README claim.
