# 0006. Z-order with fractional indexing, written in-house

Status: accepted, 2026-10-03

## Context

Z-order has to survive concurrent reordering. Storing an array index per node does not work: two people sending "bring to front" would write the same integer. Storing the order in a `Y.Array` would mean moving elements, and Yjs has no native move.

The brief asks for my own fractional indexing module, tested, with a random suffix so concurrent inserts into the same gap do not collide. The `fractional-indexing` package (4.0.0, CC0) is a reference for the idea. I use it for nothing else and write the code from scratch.

## Decision

`packages/model/src/fractional-index.ts`:

- Keys are strings over the base 62 alphabet `0-9A-Za-z`, compared as plain strings (ASCII order matches digit order).
- `between(lower, upper, random)` returns a key strictly between the two, either bound may be absent. `after(key)` and `before(key)` are the common cases (bring to front, send to back).
- A short random suffix is appended after the midpoint so two clients inserting into the same gap produce different keys. The random source is injected, so the simulator is deterministic.
- Keys never end with the lowest digit, which would leave no room below them.
- The rendering order is `(z, id)`. The id breaks the remaining ties, so every replica sorts identically even if two keys collide.
- Reordering writes the `z` of the moved node only. No other node is touched.

## Alternatives

- Integer ranks with renumbering: renumbering is a repair write and storms under concurrency.
- LSEQ or a CRDT list: heavier, and z-order does not need interleaving semantics.
- The npm package: fewer lines for me to write, but the brief asks for the module and its tests.

## Consequences

- Repeated inserts into the same gap grow the key by about one character per six inserts. There is no rebalancing, because that would need a coordinated write. A long-lived hot gap is a known limit and goes into the README.
- Property tests (fast-check) cover ordering after random sequences of inserts, strictness of the bounds, uniqueness under a shared gap and determinism for a given random source.
