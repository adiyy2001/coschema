# 0006. Z-order with fractional indexing, written in-house

Status: accepted, 2026-10-03

## Context

Z-order has to survive concurrent reordering. Storing an array index per node does not work: two people sending "bring to front" would write the same integer. Storing the order in a `Y.Array` would mean moving elements, and Yjs has no native move.

I write my own fractional indexing module, tested, with a random suffix so concurrent inserts into the same gap do not collide. The `fractional-indexing` package (4.0.0, CC0) is a reference for the idea. I use it for nothing else and write the code from scratch.

## Decision

`packages/model/src/fractional-index.ts`:

- Keys are strings over the base 62 alphabet `0-9A-Za-z`, compared as plain strings (ASCII order matches digit order).
- `between(lower, upper, random)` returns a key strictly between the two, either bound may be absent. `after(key)` and `before(key)` are the common cases (bring to front, send to back).
- A short random suffix is appended after the midpoint so two clients inserting into the same gap produce different keys. The random source is injected, so the simulator is deterministic.
- Keys never end with the lowest digit, which would leave no room below them.
- Two special cases keep common patterns short. Appending after the last key bumps the first digit by one (so bringing a node to the front over and over costs one character per 60 or so appends), and inserting before the first key lowers the first digit by one. Everything else bisects the gap digit by digit.
- The random suffix is four digits (14.7 million values per gap). When the midpoint is a prefix of the upper bound, the suffix is itself drawn below the remainder of that bound, so a key can never land above it.
- The rendering order is `(z, id)`. The id breaks the remaining ties, so every replica sorts identically even if two keys collide.
- Reordering writes the `z` of the moved node only. No other node is touched.

## Alternatives

- Integer ranks with renumbering: renumbering is a repair write and storms under concurrency.
- LSEQ or a CRDT list: heavier, and z-order does not need interleaving semantics.
- The npm package: fewer lines for me to write, but writing the module and its tests is part of what the project shows.

## Consequences

- Inserts that always go to the front or the back stay short: the tests pin 1,000 of them under 64 characters. Repeated inserts into one shrinking gap stay under 64 characters for 1,000 inserts too. The worst case is alternating inserts between the two newest keys, which grow by about half a character each, and the tests pin 1,000 of those under 600 characters. There is no rebalancing, because that would need a coordinated write. A hot gap hammered by thousands of alternating inserts is a known limit and goes into the README.
- The 4 digit suffix makes a collision between two clients inserting into the same gap a one in 14.7 million event. The `(z, id)` rule makes even that harmless: the order is still the same on every replica.
- Property tests (fast-check) cover ordering after random sequences of inserts, strictness of the bounds, uniqueness under a shared gap and determinism for a given random source.
