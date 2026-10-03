# 0022. Collaboration in the editor: where the room, the pending count and the seed live

Status: accepted, 2026-10-03

## Context

M6 puts the sync client, the IndexedDB copy and presence into the Angular editor. Five questions had no answer in the earlier ADRs: how to count pending updates after a reload, who writes the starter diagram into a shared room, how the editor finds the server, what happens when two people type into one label while offline, and whether the local sandbox and a room are the same page.

## Decision

Pending count. The wire protocol of ADR 0009 defines pending as `localSeq - ackedSeq`, and `localSeq` starts at zero in a new tab. After a reload the editor stores only the pending count per room in `localStorage` under `coschema:pending:<room>` and passes it to `SyncClient` as `initialPending`. With no record but a non-empty document on disk, the restored count is 1. The client is created after the IndexedDB copy has loaded, so updates that come from disk are never counted as local. The count is an indicator. Delivery does not depend on it: the first sync after a reconnect sends the full state diff either way.

Seeding. A room page does not write the starter diagram when it opens. After the first sync it checks `meta.seeded`, and only if that flag is absent and both maps are empty does it write the starter diagram and the flag in one transaction. The local sandbox at `/` seeds immediately, as before. If two first visitors seed at once, both write the same ids and the same content, so the merge is identical to one seed. A second visitor who connects after the first has synced sees the flag and writes nothing, even if the diagram was later emptied.

Where the server is. By default the editor uses its own origin: `/ws/rooms/:room` for the socket and `/api/dev/token` for the token. nginx in the compose stack strips the prefix and forwards to the server. The e2e suite and the latency bench use `?server`. `?server=http://host:port` points the editor at another server, and `?token=` gives a fixed token with no refresh. The dev token provider asks again once after the server denies a token, and shows a denied state if the second try fails.

Concurrent label edits. Labels are `Y.Text`. Two people who both type into the same label offline will get both insertions, and characters from the two runs can interleave when the runs start at the same position. That is the correct result for a text CRDT and the e2e test asserts convergence, not a particular string.

Follow mode. A person who follows you is not followed back. Without that rule, two people who follow each other would apply each other's viewport in a loop. Any viewport change that differs from the last one the follower applied stops following.

Two pages. `/` is a local sandbox with no network and no `Collaboration` service, and `/r/:room` provides it. Components read the service optionally, so the sandbox needs no stubs and shows "Local only". Joining another room is a full page navigation, which gives each room a fresh document, awareness and IndexedDB database.

## Alternatives

- Keep the whole pending state in IndexedDB next to the document. It survives a cleared `localStorage`, but it needs an async read before the first render and a second database to keep in step.
- Compute pending from a state vector diff against the server after reload. It is exact but needs a round trip, so the indicator would be blank while offline, which is when it matters.
- Let the server seed new rooms. It breaks the rule that the server stays ignorant of the diagram schema.
- One page with a mode switch instead of two routes. It keeps both code paths alive in every component.

## Consequences

- The pending count can be off after a reload: it may say 1 when several edits are waiting, and it may say 1 for a document that was already delivered. It always reaches 0 after the first ack.
- The seed has a window in which two cold starts both write. The result is identical, but it costs one duplicate update in the log.
- Clearing site data while offline loses undelivered edits, as with any browser storage.
- The unit tests use fake-indexeddb and memory transports, and the Playwright suite runs seven collaboration tests against the built server on the memory store and against PostgreSQL (`pnpm test:e2e:postgres`).
- `pnpm bench:latency` measures the time from the writer's pointerup to the reader's rendered change. The method and the numbers are in `bench/results/latency.json`.
