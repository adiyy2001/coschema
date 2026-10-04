# 0007. Graph validity is enforced at read time, never by repair writes

Status: accepted, 2026-10-03

## Context

Two people editing at once can produce documents no single person would have written: an edge pointing at a node someone else just deleted, a connection made to a node that is disappearing, a label edited inside a deleted node. I have to choose between a derived view that hides the problems and deterministic repair writes, and to avoid repair storms.

## Decision

The `Y.Doc` is allowed to hold invalid data. Everything that renders or announces reads through a derived view (`deriveGraph`, with an incremental store on top of it) that applies the validity rules and never writes:

1. An edge is visible only if its source and target nodes exist and their ports exist on the node type.
2. A self-loop is hidden.
3. Nodes are ordered by `(z, id)` and ids are unique by construction (map keys).
4. Sizes outside the allowed range are clamped when read.
5. Anything else malformed is read defensively and never throws: an unknown node type reads as a rectangle, a bad position as the origin, a bad order key as the lowest one, and an edge with missing fields is hidden. A client from a newer or buggy version cannot crash the others.

Local commands keep the document tidy on their own side: deleting a node deletes the edges attached to it in the same transaction. The cascade belongs to the person's own action, runs only for local edits and is a single undo step.

No client and no server writes in response to a remote update, so there is nothing to storm.

Case by case:

| Case | Result on every replica |
| --- | --- |
| Edge whose endpoint was deleted concurrently | Edge hidden. Comes back if the delete is undone. |
| Node moved by two people | One of the two positions wins, by Yjs's deterministic ordering. |
| Label edited while the node is deleted | Node gone, edit dropped (ADR 0005). |
| Connection to a node someone else is deleting | Edge exists in the document, hidden because the target is gone. |

The convergence simulator asserts that after healing, every replica derives the same graph and that the graph satisfies the rules.

## Alternatives

- Repair writes on every client: N clients all delete the same dangling edge, producing N overlapping operations, and each repair can fight with an undo.
- Repair writes on the server only: one writer, no storm, but the server becomes a second author of the document, and a restored node (undo) would find its edges already gone.

## Consequences

- Hidden edges stay in the document until the node comes back or the edge is deleted. They are small. Compaction does not remove them. A server-side sweep is possible later and would be a separate decision.
- Any new code path that reads the document directly instead of through the view is a bug. A lint rule or an architecture test should make that hard to do by accident.
