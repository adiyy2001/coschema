# 0015. Orthogonal routing: A* on a sparse grid built from obstacle edges

Status: accepted, 2026-10-03

## Context

Edges are orthogonal polylines that avoid nodes. Diagrams can have thousands of nodes, and any node can move at any time, from any client, so routing must be cheap and must never be written to the shared document.

## Decision

`packages/geometry/src/router`:

1. Build the obstacle set: every node rectangle inflated by a margin (12 units), except the rectangles of the edge's own endpoints, which are entered through a port stub.
2. Build a sparse grid: the distinct x and y coordinates of the inflated obstacle edges, the port stubs and the routing window, so a grid node sits where a line could turn without hugging an obstacle. This is a Hanan style grid, far smaller than a uniform grid over the same area.
3. Run A* over grid nodes. Neighbours are the next grid node in each of the four directions, blocked when the segment crosses an obstacle interior. Cost is segment length plus a bend penalty, and the heuristic is Manhattan distance. Ties are broken by insertion order so results are deterministic.
4. Simplify: merge collinear points. User waypoints, if any, split the route into legs that are routed one by one.
5. Cache by edge id, keyed by the endpoints, ports, waypoints and a hash of the obstacles in the routing window. Only edges whose window saw a change are re-routed.

Routing is a pure view function. The document stores only user-defined waypoints, so two clients with the same document draw the same routes without exchanging them.

## Alternatives

- Uniform grid A*: simple, but memory and time grow with area and the paths hug the grid instead of the obstacles.
- A visibility graph: shorter paths with diagonals, and orthogonality has to be forced back in.
- Storing routes in the document: heavy, and every move of a node would rewrite every touching edge.
- A routing library: the brief says no diagram library, and the algorithm is part of what the project shows.

## Consequences

- A route that has no path (an endpoint boxed in) falls back to a straight stub plus an L shape, drawn dashed, and the test suite has a case for it.
- Property tests compare path cost against a brute-force search on a small uniform grid, and check that no segment crosses an obstacle interior.
- If routing ever shows up in a profile, it can move to a Web Worker without changing its interface.
