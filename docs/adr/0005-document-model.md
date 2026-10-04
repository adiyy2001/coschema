# 0005. Document model: maps of maps, atomic geometry, delete wins

Status: accepted, 2026-10-03

## Context

The outline is fixed: nodes in a `Y.Map` keyed by id, with position, size, type, style and a label as `Y.Text`; edges in a second `Y.Map` with source, target, ports and waypoints. What is left open is how fine-grained each field should be and what a delete does to concurrent edits.

## Decision

Root of the `Y.Doc`: `nodes` (`Y.Map` of `Y.Map`), `edges` (`Y.Map` of `Y.Map`) and `meta` (schema version).

Node fields: `type`, `pos` (`[x, y]`), `size` (`[w, h]`), `z` (fractional key, ADR 0006), `style` (a small `Y.Map`, created together with the node and left empty, so two people changing fill and stroke both win) and `label` (`Y.Text`).

Edge fields: `source`, `target`, `sourcePort`, `targetPort`, `waypoints` (only user-defined bends, atomic). Routed segments are computed in the view and never stored (ADR 0015).

`pos` and `size` are written as whole tuples. Two people dragging the same node concurrently then produce one of the two positions, never an x from one and a y from the other. A move and a resize do not conflict because they are different keys.

Deleting a node removes its key from `nodes` ("delete wins"). The command also deletes the edges attached to it, in the same transaction, so the whole thing is one undo step. A concurrent label edit or move inside a deleted node is dropped.

Ids are 16 character base62 strings generated from an injectable random source, so the simulator can be seeded and 5,000 nodes stay cheap.

I verified the delete behaviour against Yjs 13.6.33 on 2026-10-03: with a concurrent label edit and delete, both replicas converge on an empty map, and `Y.UndoManager` restores the node with the label as it was at deletion time.

## Alternatives

- Soft delete with a `deleted` flag: keeps concurrent label edits and makes restore trivial, but tombstones can never be dropped without a repair write, so the document only grows.
- One atomic `bounds` value: simpler, but a resize by one person would overwrite a move by another.
- Separate `x` and `y` keys: allows the torn positions described above.

## Consequences

- The `style` map is created with the node on purpose. If it were created on first use, two people styling a fresh node at once would each create a map, one map would win and the other person's fill would be lost.

- Observers must key everything by node id, never by the identity of the nested `Y.Map`: undo recreates the nested types as copies.
- A person can lose a label edit if someone deletes the node at the same moment. I accept that.
