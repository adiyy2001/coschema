# 0014. SVG rendering with one world transform and grid-based culling

Status: accepted, 2026-10-03

## Context

The brief requires an own SVG renderer, no diagram library, and 60 fps panning with 5,000 nodes. The SVG DOM gets slow at a few thousand elements with layout and style work, so the number of elements in the DOM has to stay small, and panning must not touch most of them.

## Decision

- Three layers inside one `<svg>`: edges, nodes, and an overlay (selection, marquee, connection preview, remote cursors, remote selections, viewport indicators). All of them live in a single world `<g>` whose `transform` is the viewport (pan and zoom). Panning changes one attribute.
- A uniform spatial grid over node bounds (cell size 512 world units) in `packages/geometry`. The visible node set is the set of nodes in the cells that intersect the viewport plus a margin of one cell.
- The visible cell window is a `computed` signal with a custom equality function, so while the pan stays inside the same window nothing downstream recomputes. `@for` tracks by node id. Each node is a small component with an attribute selector (`<g cs-node>`), signal inputs and `OnPush`.
- Edges are culled with their routed bounding box, and routing is cached (ADR 0015).
- Three levels of detail by zoom. From 0.7 up everything is drawn with labels (`full`). From 0.25 to 0.7 nodes and edges are drawn without labels (`simple`). Below 0.25 the scene is two `<path>` elements, one with every node rectangle and one with a straight line per edge, plus a third path for the selection (`minimal`). Routes are computed only for edges that are in the window and not in the minimal level.
- The Yjs document feeds the UI through an incremental graph store: an observer collects the node and edge ids that changed in a transaction, and the store recomputes only those. Updates are batched to one per animation frame.
- The first deliverable of the editor milestone is a 5,000 node benchmark page. If panning in headless Chrome does not hold 60 fps there, the renderer changes before any interaction code is written.

## Alternatives

- Canvas or WebGL: faster at scale, but the brief asks for SVG and SVG is accessible by construction (focusable elements, ARIA).
- `content-visibility` and CSS containment alone: helps layout, does not cut the number of Angular views.
- A virtual scroll component: designed for lists, not a 2D plane.

## Consequences

- Elements outside the window do not exist in the DOM, so find-in-page and screen reader browse mode do not see them. The keyboard model (ADR 0016) works from the store, not from the DOM, and brings the focused node into view.
- The benchmark numbers (frame times, hardware, browser) come from `bench/` and are the only source for the README claim.
- The grid returns the nodes of a query in no particular order, because sorting the hits cost more than the query itself. The editor orders by z anyway. `bench:geometry` compares every query with a linear scan: the grid is several times faster at normal zoom, and a plain scan of 5,000 rectangles is as fast once a few hundred nodes are in view. Both take well under a frame, so the grid is there for the stable window, not for raw speed.

## Gate result (M5)

The gate ran first, on the 5,000 node scene (`/bench`, seeded, about 7,000 edges) in headless Chromium 153 on a 12th Gen Intel i7-12700H under WSL2, driving the pan with synthetic wheel events from a `requestAnimationFrame` loop. `bench/results/pan.json` holds the numbers. In the final run every zoom from 1 down to 0.05 has a median of 60 fps and a worst run of 59.7 fps or better, with no long tasks.

What the gate found on the way, in order:

- The first version drew every visible node and edge as components at every zoom. Zoom 1 and 0.35 held 60 fps, but at zoom 0.1 (the whole scene in view) it was 22 fps: the window holds thousands of components, and any window change rebuilds them. Fix: the `minimal` level above, which makes the whole scene a constant number of elements (11 SVG elements at 0.1). A first version of it only drew the nodes in the cell window, and at zoom 0.05 the window changed every few frames, so the path strings were rebuilt while panning (55 fps median). The overview paths now cover the whole document and depend on the graph revision only, so panning is one transform change.
- Labels are the expensive part of the `full` level. At zoom 0.5 with labels the median was 35.6 fps with about 300 nodes in the DOM, at the same zoom without labels 60 fps. A label at 0.5 is 7 px tall, so the `full` level starts at 0.7.
- At zoom 0.2 about 1,200 nodes and 1,900 edges are in the DOM and one run had a 47 fps minimum and a 136 ms task, so the `minimal` level starts at 0.25. The bench covers 1, 0.75, 0.5, 0.35, 0.25, 0.2, 0.1 and 0.05.
- One bench run of the same build had a median of 52.9 fps at zoom 1 while other processes loaded the machine (load average about 7.8 on 20 logical cores). The next run on the same build, with a load average of about 3, had 60 fps. Numbers from a loaded machine are not kept in `pan.json`.

Drag does not write to the document on every pointer move. The renderer keeps a transient position override per node (`GraphView.setPreview`), which moves the node and reroutes its edges at one update per frame, and the release commits one `moveNodes` inside one history gesture.
