import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { LiveAnnouncer, type ChangeNote } from './announcer';

@Injectable()
export class Announcements {
  readonly message = signal('');
  private readonly announcer = new LiveAnnouncer({
    clock: inject(COLLAB_CLOCK),
    onMessage: (text) => {
      this.message.set(text);
    },
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.announcer.destroy();
    });
  }

  announce(text: string): void {
    this.announcer.announceNow(text);
  }

  note(change: ChangeNote): void {
    this.announcer.enqueue(change);
  }
}
