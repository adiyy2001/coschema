import type { NodeType } from '@coschema/model';
import type { LinkProfileName } from './link';

export type Operation =
  | {
      readonly type: 'create';
      readonly nodeType: NodeType;
      readonly x: number;
      readonly y: number;
      readonly label: string;
    }
  | { readonly type: 'move'; readonly node: number; readonly dx: number; readonly dy: number }
  | {
      readonly type: 'drag';
      readonly node: number;
      readonly dx: number;
      readonly dy: number;
      readonly frames: number;
    }
  | { readonly type: 'delete'; readonly node: number }
  | {
      readonly type: 'connect';
      readonly source: number;
      readonly target: number;
      readonly sourcePort: number;
      readonly targetPort: number;
    }
  | { readonly type: 'disconnect'; readonly edge: number }
  | {
      readonly type: 'edit-label';
      readonly node: number;
      readonly at: number;
      readonly remove: number;
      readonly insert: string;
    }
  | { readonly type: 'reorder'; readonly node: number; readonly to: number }
  | {
      readonly type: 'reorder-many';
      readonly nodes: readonly number[];
      readonly target: 'front' | 'back';
    }
  | { readonly type: 'style'; readonly node: number; readonly fill: string }
  | {
      readonly type: 'resize';
      readonly node: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'presence'; readonly x: number; readonly y: number };

export type NetworkAction =
  | { readonly type: 'degrade'; readonly profile: LinkProfileName }
  | { readonly type: 'partition' }
  | { readonly type: 'unpartition' }
  | { readonly type: 'offline' }
  | { readonly type: 'online' }
  | { readonly type: 'reconnect' };

export type Step =
  | { readonly kind: 'operation'; readonly client: number; readonly operation: Operation }
  | { readonly kind: 'network'; readonly client: number; readonly action: NetworkAction }
  | { readonly kind: 'advance'; readonly ms: number };

export interface Scenario {
  readonly seed: number;
  readonly clients: number;
  readonly steps: readonly Step[];
}

export const MIN_CLIENTS = 2;
export const MAX_CLIENTS = 8;

export function clampClientCount(count: number): number {
  return Math.min(MAX_CLIENTS, Math.max(MIN_CLIENTS, Math.trunc(count)));
}

export function clientOf(step: Step, clients: number): number | undefined {
  return step.kind === 'advance' ? undefined : ((step.client % clients) + clients) % clients;
}

export function pickByIndex<T>(items: readonly T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  const position = ((Math.trunc(index) % items.length) + items.length) % items.length;
  return items[position];
}

export function describeStep(step: Step): string {
  return JSON.stringify(step);
}
