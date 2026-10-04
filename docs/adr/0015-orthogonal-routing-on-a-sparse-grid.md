# 0015. Orthogonal routing: A* on a sparse grid built from obstacle edges

Status: accepted, 2026-10-03

## Context

Edges are orthogonal polylines that avoid nodes. Diagrams can have thousands of nodes, and any node can move at any time, from any client, so routing must be cheap and must never be written to the shared document.

## Decision

`packages/geometry/src/router`:

1. Pick the ports. Every port has a side (`n`, `e`, `s`, `w`; the corner ports leave horizontally). The route leaves the source anchor along that side and arrives at the target anchor against its side, through a stub of 12 units. When two facing ports are closer than two stubs, both stubs shrink to meet in the middle.
2. Build the obstacle set: every node rectangle inflated by a margin (12 units). The two endpoint nodes are obstacles too, so a route cannot cut across the node it starts from. The stub ends sit exactly on the inflated boundary, which a route may touch. If an end point (a stub end or a waypoint) lies inside the margin of another node, that node is used uninflated for this edge. If it lies inside the node itself, there is no route.
3. Build a sparse grid inside a routing window: the distinct x and y coordinates of the inflated obstacle edges, the stub ends, the waypoints and the window edges (a Hanan style grid, far smaller than a uniform grid over the same area). The window starts at the end points plus 96 units, widens to 768 units, and last covers every obstacle. Obstacles cut by the window are clipped and remember which sides were cut, so the window edge is blocked where the real obstacle continues. A route therefore depends only on the obstacles in its window, which is what the cache relies on.
4. Run A* over (grid node, direction) states. Neighbours are the next grid node in each of the four directions, blocked when the segment crosses an obstacle interior. Cost is segment length plus a bend penalty (24), a 180 degree turn is not allowed, and the heuristic is Manhattan distance. Ties are broken by insertion order and obstacles are sorted before the grid is built, so the output does not depend on the order nodes were added in. The arrival direction at the target stub counts as a bend when it does not match the port.
5. Simplify: drop repeated and collinear points. User waypoints split the route into legs that are routed one by one.
6. Cache by edge id. An entry stores the request (endpoints, ports, waypoints, options) and an order independent fingerprint of the obstacles in the windows the route was computed from. A moved node outside those windows keeps the entry valid.

Routing is a pure view function. The document stores only user-defined waypoints, so two clients with the same document draw the same routes without exchanging them.

## Alternatives

- Uniform grid A*: simple, but memory and time grow with area and the paths hug the grid instead of the obstacles.
- A visibility graph: shorter paths with diagonals, and orthogonality has to be forced back in.
- Storing routes in the document: heavy, and every move of a node would rewrite every touching edge.
- A routing library: no diagram library is allowed here, and the algorithm is part of what the project shows.

## Consequences

- A route that has no path (an endpoint boxed in, a stub inside another node, a waypoint inside a node) falls back to the stubs plus L shapes through the waypoints, flagged `fallback: true` so the renderer can draw it dashed. The test suite has a case for each.
- The property tests compare the path cost with a brute-force Dijkstra on a uniform integer grid, and check that no segment crosses an obstacle interior. The cost is the same only when the end directions are free. A fixed start direction can force a U-turn whose width is arbitrary, and the sparse grid then picks the nearest grid line instead of the narrowest detour, so with directions the test checks that the sparse cost is never lower, and that it is equal once every integer coordinate is a grid line.
- Measured by `pnpm bench:geometry` (numbers in `bench/results/geometry.json`): routing every edge of the 5,000 node scene takes 100 to 140 ms on the development laptop (a few tens of microseconds per edge), and moving one node and re-routing its edges takes well under a millisecond.
- If routing ever shows up in a profile, it can move to a Web Worker without changing its interface.
