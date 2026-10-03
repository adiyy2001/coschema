import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { SyncClient } from '@coschema/sync';
import { COLLAB_CLOCK, Collaboration } from '../collab/collaboration';
import { DocumentSession } from '../core/document-session';
import { actorName } from './actor';
import { Announcements } from './announcements';
import { describeDelta } from './describe-change';

@Injectable()
export class RemoteChangeNarrator {
  private armed = false;

  constructor() {
    const collaboration = inject(Collaboration, { optional: true });
    if (collaboration === null) return;
    const session = inject(DocumentSession);
    const announcements = inject(Announcements);
    const clock = inject(COLLAB_CLOCK);
    const unsubscribe = session.graph.subscribeChanges((delta, change) => {
      if (!this.armed || change.local || !(change.origin instanceof SyncClient)) return;
      const actor = actorName(
        collaboration.presence.peers(),
        change.authors,
        collaboration.presence.localClientId,
      );
      const notes = describeDelta(delta, {
        actor,
        at: clock.now(),
        lookupNode: (id) => session.graph.committedNode(id),
      });
      for (const note of notes) announcements.note(note);
    });
    effect(() => {
      if (collaboration.session.synced()) this.armed = true;
    });
    inject(DestroyRef).onDestroy(unsubscribe);
  }
}
