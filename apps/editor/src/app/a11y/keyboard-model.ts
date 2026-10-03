import type { Rect } from '@coschema/geometry';
import type { EdgeId, NodeId } from '@coschema/model';
import type { Selection } from '../interaction/types';
import { nearestInDirection, stepThrough, type Direction, type PlacedNode } from './ordering';

export type FocusTarget =
  { readonly kind: 'node'; readonly id: NodeId } | { readonly kind: 'edge'; readonly id: EdgeId };

export interface KeyInput {
  readonly key: string;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly repeat: boolean;
}

export type KeyMode =
  | { readonly kind: 'browse' }
  | { readonly kind: 'connect'; readonly sourceId: NodeId; readonly candidate: NodeId | undefined };

export const BROWSE: KeyMode = { kind: 'browse' };

export interface KeyboardEnv {
  readonly focus: FocusTarget | undefined;
  readonly selection: Selection;
  readonly nodeOrder: () => readonly NodeId[];
  readonly edgeOrder: () => readonly EdgeId[];
  readonly gridSize: number;
  readonly placedNodes: () => readonly PlacedNode[];
  readonly rectOf: (id: NodeId) => Rect | undefined;
  readonly nameOf: (target: FocusTarget) => string;
}

export type KeyEffect =
  | { readonly kind: 'focus'; readonly target: FocusTarget }
  | {
      readonly kind: 'move';
      readonly ids: readonly NodeId[];
      readonly dx: number;
      readonly dy: number;
      readonly burst: boolean;
    }
  | { readonly kind: 'panView'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'editLabel'; readonly id: NodeId }
  | {
      readonly kind: 'previewConnect';
      readonly sourceId: NodeId;
      readonly targetId: NodeId | undefined;
    }
  | { readonly kind: 'commitConnect'; readonly sourceId: NodeId; readonly targetId: NodeId }
  | { readonly kind: 'cancelConnect' }
  | { readonly kind: 'deleteSubject' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'help' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'announce'; readonly text: string };

export interface KeyOutcome {
  readonly mode: KeyMode;
  readonly effects: readonly KeyEffect[];
  readonly handled: boolean;
}

export const BIG_STEP_FACTOR = 10;
export const VIEW_PAN_STEP = 48;

const UNHANDLED: KeyOutcome = { mode: BROWSE, effects: [], handled: false };

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const UNIT: Readonly<Record<Direction, readonly [number, number]>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export const CONNECT_PROMPT =
  'Connect mode. Choose a target with the arrow keys or N and P, press Enter to connect, Escape to cancel.';

function handled(mode: KeyMode, ...effects: KeyEffect[]): KeyOutcome {
  return { mode, effects, handled: true };
}

function focusedNode(env: KeyboardEnv): NodeId | undefined {
  return env.focus?.kind === 'node' ? env.focus.id : undefined;
}

function movableNodes(env: KeyboardEnv): readonly NodeId[] {
  const focused = focusedNode(env);
  if (focused !== undefined) {
    return env.selection.nodes.includes(focused) ? env.selection.nodes : [focused];
  }
  return env.focus === undefined ? env.selection.nodes : [];
}

function sequenceOf(env: KeyboardEnv): readonly FocusTarget[] {
  return [
    ...env.nodeOrder().map((id): FocusTarget => ({ kind: 'node', id })),
    ...env.edgeOrder().map((id): FocusTarget => ({ kind: 'edge', id })),
  ];
}

function sameTarget(left: FocusTarget | undefined, right: FocusTarget): boolean {
  return left !== undefined && left.kind === right.kind && left.id === right.id;
}

function stepFocus(env: KeyboardEnv, step: 1 | -1): KeyOutcome {
  const sequence = sequenceOf(env);
  const current = sequence.find((entry) => sameTarget(env.focus, entry));
  const next = stepThrough(sequence, current, step);
  return next === undefined ? handled(BROWSE) : handled(BROWSE, { kind: 'focus', target: next });
}

function focusInDirection(env: KeyboardEnv, direction: Direction): KeyOutcome {
  const origin = focusedNode(env);
  const originRect = origin === undefined ? undefined : env.rectOf(origin);
  if (origin === undefined || originRect === undefined) return stepFocus(env, 1);
  const others = env.placedNodes().filter((entry) => entry.id !== origin);
  const target = nearestInDirection(originRect, others, direction);
  return target === undefined
    ? handled(BROWSE)
    : handled(BROWSE, { kind: 'focus', target: { kind: 'node', id: target } });
}

function moveOrPan(env: KeyboardEnv, direction: Direction, input: KeyInput): KeyOutcome {
  const factor = input.shift ? BIG_STEP_FACTOR : 1;
  const [ux, uy] = UNIT[direction];
  const ids = movableNodes(env);
  if (ids.length > 0) {
    const step = env.gridSize * factor;
    return handled(BROWSE, {
      kind: 'move',
      ids,
      dx: ux * step,
      dy: uy * step,
      burst: input.repeat,
    });
  }
  const pan = VIEW_PAN_STEP * factor;
  return handled(BROWSE, { kind: 'panView', dx: ux * pan, dy: uy * pan });
}

function beginConnect(env: KeyboardEnv): KeyOutcome {
  const sourceId = focusedNode(env);
  if (sourceId === undefined) {
    return handled(BROWSE, {
      kind: 'announce',
      text: 'Focus a node first, then press C to connect it.',
    });
  }
  return handled(
    { kind: 'connect', sourceId, candidate: undefined },
    { kind: 'previewConnect', sourceId, targetId: undefined },
    { kind: 'announce', text: CONNECT_PROMPT },
  );
}

function chooseCandidate(
  mode: Extract<KeyMode, { kind: 'connect' }>,
  env: KeyboardEnv,
  pick: (candidates: readonly PlacedNode[], from: Rect) => NodeId | undefined,
): KeyOutcome {
  const candidates = env.placedNodes().filter((entry) => entry.id !== mode.sourceId);
  const anchor = env.rectOf(mode.candidate ?? mode.sourceId);
  const chosen = anchor === undefined ? undefined : pick(candidates, anchor);
  if (chosen === undefined) return handled(mode);
  const label = env.nameOf({ kind: 'node', id: chosen });
  return handled(
    { kind: 'connect', sourceId: mode.sourceId, candidate: chosen },
    { kind: 'previewConnect', sourceId: mode.sourceId, targetId: chosen },
    { kind: 'announce', text: `Connect to ${label}. Press Enter to confirm.` },
  );
}

function reduceConnect(
  mode: Extract<KeyMode, { kind: 'connect' }>,
  input: KeyInput,
  env: KeyboardEnv,
): KeyOutcome {
  if (input.ctrl || input.meta) return UNHANDLED;
  const direction = ARROWS[input.key];
  if (direction !== undefined) {
    return chooseCandidate(mode, env, (candidates, from) =>
      nearestInDirection(from, candidates, direction),
    );
  }
  const lower = input.key.toLowerCase();
  if (lower === 'n' || lower === 'p') {
    const step = lower === 'n' ? 1 : -1;
    return chooseCandidate(mode, env, (candidates) =>
      stepThrough(
        env.nodeOrder().filter((id) => id !== mode.sourceId && candidates.some((c) => c.id === id)),
        mode.candidate,
        step,
      ),
    );
  }
  if (input.key === 'Enter') {
    if (mode.candidate === undefined) {
      return handled(mode, { kind: 'announce', text: 'Choose a target first.' });
    }
    return handled(BROWSE, {
      kind: 'commitConnect',
      sourceId: mode.sourceId,
      targetId: mode.candidate,
    });
  }
  if (input.key === 'Escape') {
    return handled(
      BROWSE,
      {
        kind: 'cancelConnect',
      },
      { kind: 'announce', text: 'Connection cancelled.' },
    );
  }
  if (input.key === 'Tab')
    return { mode: BROWSE, effects: [{ kind: 'cancelConnect' }], handled: false };
  return handled(mode);
}

function reduceBrowse(input: KeyInput, env: KeyboardEnv): KeyOutcome {
  const modifier = input.ctrl || input.meta;
  const lower = input.key.toLowerCase();
  if (modifier) {
    if (lower === 'z') return handled(BROWSE, { kind: input.shift ? 'redo' : 'undo' });
    if (lower === 'y') return handled(BROWSE, { kind: 'redo' });
    return UNHANDLED;
  }
  const direction = ARROWS[input.key];
  if (direction !== undefined) {
    return input.alt ? focusInDirection(env, direction) : moveOrPan(env, direction, input);
  }
  if (input.alt) return UNHANDLED;
  switch (input.key) {
    case 'Delete':
    case 'Backspace':
      return env.focus === undefined &&
        env.selection.nodes.length + env.selection.edges.length === 0
        ? UNHANDLED
        : handled(BROWSE, { kind: 'deleteSubject' });
    case 'Enter':
    case 'F2': {
      const id =
        focusedNode(env) ?? (env.selection.nodes.length === 1 ? env.selection.nodes[0] : undefined);
      return id === undefined ? UNHANDLED : handled(BROWSE, { kind: 'editLabel', id });
    }
    case 'Escape':
      return handled(BROWSE, { kind: 'escape' });
    case '?':
      return handled(BROWSE, { kind: 'help' });
  }
  if (lower === 'c' && input.key.length === 1) return beginConnect(env);
  if (lower === 'n' && input.key.length === 1) return stepFocus(env, 1);
  if (lower === 'p' && input.key.length === 1) return stepFocus(env, -1);
  return UNHANDLED;
}

export function reduceKey(mode: KeyMode, input: KeyInput, env: KeyboardEnv): KeyOutcome {
  return mode.kind === 'connect' ? reduceConnect(mode, input, env) : reduceBrowse(input, env);
}
