import { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

export function createAwareness(doc: Y.Doc): Awareness {
  const awareness = new Awareness(doc);
  clearInterval(awareness._checkInterval as ReturnType<typeof setInterval>);
  awareness.setLocalState(null);
  return awareness;
}
