import type * as Y from 'yjs';
import type { RandomSource } from '../base62';

export interface CommandContext {
  readonly doc: Y.Doc;
  readonly origin: unknown;
  readonly random: RandomSource;
}

export function runInTransaction<T>(context: CommandContext, work: () => T): T {
  return context.doc.transact(work, context.origin);
}

export function assertFinitePoint(point: readonly [number, number], name: string): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new RangeError(`${name} must be finite`);
  }
}
