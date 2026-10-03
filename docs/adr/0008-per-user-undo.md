# 0008. Per-user undo with Y.UndoManager and explicit gestures

Status: accepted, 2026-10-03

## Context

In a shared document, "undo" has to mean "undo what I did", not "undo the last thing in the document". Users also expect one drag to be one undo step, even though a drag produces dozens of position updates.

## Decision

- One `Y.UndoManager` per client, scoped to the `nodes` and `edges` maps (labels live inside nodes, so they are in scope).
- `trackedOrigins` contains only the local origin object. Remote updates, the IndexedDB load and the sync provider use other origins and never enter the stack.
- `captureTimeout` is set to `Number.MAX_SAFE_INTEGER`, so nothing merges by time (Yjs also never merges into an item after `stopCapturing()`, because that resets its last change time to 0). The `History` wrapper in `packages/model` exposes `beginGesture()` and `run(fn)`. Both call `stopCapturing()` when the outermost gesture opens and closes. A drag, a marquee move, a paste or a label editing session is one step; the pointer-move writes in between all merge into it. Gestures nest, and only the outermost one cuts the stack.
- Outside a gesture every local transaction is its own step. A `beforeTransaction` hook calls `stopCapturing()` for local transactions when no gesture is open, so two quick commands never merge by accident.
- `ignoreRemoteMapChanges` stays at its default of `false`. With that default the Yjs docs promise that undo never overwrites a remote change to a map key. If someone else moved the same node after me, my undo of the move does nothing for that key. That is the right outcome: my change was already superseded. The option is marked experimental, so a test pins the behaviour.
- Undoing a move never touches the label, because `pos` and `label` are separate keys. The same holds for style properties.

Tricky cases that get tests, first against two documents and then in the simulator:

1. Undo my move after a remote label edit: the label stays.
2. Undo my move after a remote move of the same node: no change. `undo()` returns false and the item is consumed.
3. Undo my create after someone moved the node: the node goes away.
4. Undo my delete: the node, its label and the edges removed in the cascade come back, and an edge someone else connected in the meantime reappears.
5. Redo after a remote edit.
6. Remote and IndexedDB origins never land on my stack.
7. Typing in one label from two clients, then undo: only my characters go.
8. Undo and redo after a reconnect merge.

## Alternatives

- A shared undo stack: undoes other people's work.
- Inverse operations written by hand: more code, and wrong under concurrency in exactly the cases listed above.

## Consequences

- Undo restores deleted types as copies, so UI state keyed to a `Y.Map` instance goes stale (see ADR 0005). Everything is keyed by id.
- A "no-op undo" can look broken to a user. The editor announces nothing and shows no error. Whether to say "nothing to undo for this item" is a UX call for later.
