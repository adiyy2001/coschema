import * as Y from 'yjs';
import type { KeyValueStorage } from './identity';

const KEY_PREFIX = 'coschema:pending:';
const EMPTY_STATE_VECTOR_LENGTH = 1;
const WHOLE_NUMBER = /^\d{1,9}$/u;

export function pendingKey(room: string): string {
  return `${KEY_PREFIX}${room}`;
}

export function readPending(
  storage: KeyValueStorage | undefined,
  room: string,
): number | undefined {
  try {
    const raw = storage?.getItem(pendingKey(room)) ?? null;
    if (raw === null || !WHOLE_NUMBER.test(raw)) return undefined;
    return Number(raw);
  } catch {
    return undefined;
  }
}

export function writePending(
  storage: KeyValueStorage | undefined,
  room: string,
  pending: number,
): void {
  try {
    storage?.setItem(pendingKey(room), String(pending));
  } catch {
    return;
  }
}

export function restorePending(doc: Y.Doc, stored: number | undefined): number {
  if (stored !== undefined) return stored;
  return Y.encodeStateVector(doc).length > EMPTY_STATE_VECTOR_LENGTH ? 1 : 0;
}
