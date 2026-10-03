# 0024. SVG and PNG export: one pure builder, a rasterized PNG

Status: accepted, 2026-10-04

## Context

A diagram should leave the editor as a file. The canvas shows only the nodes and edges that survive culling and level of detail, and routes are computed lazily, so a screenshot of the canvas is not a faithful export. Labels and styles come from other people in a shared room, so the export must treat them as hostile text.

## Decision

`GraphView.exportScene()` returns the whole derived scene: every node and every edge, with the route of each edge taken from the route cache, not only the routes of edges that are on screen. `buildSvgDocument(scene)` is a pure function from that scene to markup plus the size, with a fixed margin around the bounding box. It shares the node outline geometry with the canvas through `canvas/node-shape.ts`, so the export and the screen cannot drift apart.

Escaping. Text and attribute values are XML escaped, and characters that are not valid in XML 1.0 (control characters, lone surrogates) are dropped by a code point filter, because one of them makes the whole file unparseable. Colours and other style values are escaped as attribute values, so a hostile value cannot close the attribute.

PNG. The SVG is drawn to a canvas through an `Image` and the canvas is encoded with `toBlob`. The preferred scale is 2. It is lowered so that the longer side stays at or under 8192 pixels and the area at or under 48 million pixels, which keeps a 5,000 node diagram from asking the browser for a bitmap it will refuse. Saving goes through a `FILE_SAVER` token and rasterizing through an `SVG_RASTERIZER` token, so tests replace both.

The toolbar has an Export group with SVG and PNG buttons. Both are disabled when the diagram is empty. A finished export is announced in the polite live region.

## Alternatives

- Serialize the canvas DOM. It misses culled nodes, depends on the zoom, and carries editor-only overlays.
- Render the PNG on the server. It adds a service and a font problem for something the browser does well.
- Use `html2canvas` or a similar library. A dependency and a licence check for work that a hundred lines do.

## Consequences

- The PNG depends on the browser decoding an SVG image. Text uses the fonts the browser has, because an SVG loaded as an image cannot fetch web fonts.
- A diagram larger than the clamps is exported at a lower scale than 2, and the SVG remains the lossless format.
- The unit tests cover the builder, the scale clamps and the service, and one end to end test downloads an SVG and checks it parses.
