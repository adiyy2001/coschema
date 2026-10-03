import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { defaultPersistence, indexedDbPersistence } from './collaboration-session';

describe('disk persistence', () => {
  it('stores a document and gives it back to a new document of the same name', async () => {
    const first = new Y.Doc();
    const writer = indexedDbPersistence('coschema:room:disk-test', first);
    await writer.loaded;
    first.getMap<string>('labels').set('a', 'kept');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writer.destroy();
    const second = new Y.Doc();
    const reader = indexedDbPersistence('coschema:room:disk-test', second);
    await reader.loaded;
    expect(second.getMap<string>('labels').get('a')).toBe('kept');
    await reader.destroy();
  });

  it('offers a factory only where IndexedDB exists', () => {
    expect(defaultPersistence()).toBe(indexedDbPersistence);
  });
});
