import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  META_KEYS,
  ROOT_EDGES,
  ROOT_NODES,
  SCHEMA_VERSION,
  getMeta,
  initializeDocument,
  readSchemaVersion,
} from '../src';

describe('document schema', () => {
  it('has no version before initialisation', () => {
    expect(readSchemaVersion(new Y.Doc())).toBeUndefined();
  });

  it('writes the schema version once and keeps the root maps', () => {
    const doc = new Y.Doc();
    initializeDocument(doc);
    initializeDocument(doc);
    expect(readSchemaVersion(doc)).toBe(SCHEMA_VERSION);
    expect(doc.share.has(ROOT_NODES)).toBe(true);
    expect(doc.share.has(ROOT_EDGES)).toBe(true);
  });

  it('does not overwrite a version written by someone else', () => {
    const doc = new Y.Doc();
    getMeta(doc).set(META_KEYS.schemaVersion, 99);
    initializeDocument(doc);
    expect(readSchemaVersion(doc)).toBe(99);
  });

  it('ignores a version that is not a number', () => {
    const doc = new Y.Doc();
    getMeta(doc).set(META_KEYS.schemaVersion, 'one');
    expect(readSchemaVersion(doc)).toBeUndefined();
  });

  it('converges when two clients initialise at the same time', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    initializeDocument(left);
    initializeDocument(right);
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    expect(readSchemaVersion(left)).toBe(SCHEMA_VERSION);
    expect(Y.encodeStateVector(left)).toEqual(Y.encodeStateVector(right));
  });
});
