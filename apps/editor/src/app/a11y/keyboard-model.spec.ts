import type { Rect } from '@coschema/geometry';
import { describe, expect, it } from 'vitest';
import {
  BIG_STEP_FACTOR,
  BROWSE,
  CONNECT_PROMPT,
  VIEW_PAN_STEP,
  reduceKey,
  type FocusTarget,
  type KeyEffect,
  type KeyInput,
  type KeyMode,
  type KeyboardEnv,
} from './keyboard-model';
import { readingOrder, type PlacedNode } from './ordering';

const RECTS: Readonly<Record<string, Rect>> = {
  a: { x: 0, y: 0, width: 100, height: 60 },
  b: { x: 300, y: 0, width: 100, height: 60 },
  c: { x: 0, y: 300, width: 100, height: 60 },
};

function key(name: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: name, shift: false, alt: false, ctrl: false, meta: false, repeat: false, ...extra };
}

function env(overrides: Partial<KeyboardEnv> = {}): KeyboardEnv {
  const placed: PlacedNode[] = Object.entries(RECTS).map(([id, rect]) => ({ id, rect }));
  return {
    focus: undefined,
    selection: { nodes: [], edges: [] },
    nodeOrder: () => readingOrder(placed),
    edgeOrder: () => ['e1', 'e2'],
    gridSize: 24,
    placedNodes: () => placed,
    rectOf: (id) => RECTS[id],
    nameOf: (target) => `name of ${target.id}`,
    ...overrides,
  };
}

const onA: FocusTarget = { kind: 'node', id: 'a' };

function effectsOf(mode: KeyMode, input: KeyInput, environment: KeyboardEnv): KeyEffect[] {
  return [...reduceKey(mode, input, environment).effects];
}

describe('browse mode', () => {
  it('moves the focused node by one grid step per arrow key', () => {
    expect(effectsOf(BROWSE, key('ArrowRight'), env({ focus: onA }))).toEqual([
      { kind: 'move', ids: ['a'], dx: 24, dy: 0, burst: false },
    ]);
    expect(effectsOf(BROWSE, key('ArrowUp'), env({ focus: onA }))).toEqual([
      { kind: 'move', ids: ['a'], dx: 0, dy: -24, burst: false },
    ]);
  });

  it('moves ten steps with shift and marks key repeats as a burst', () => {
    const effects = effectsOf(
      BROWSE,
      key('ArrowDown', { shift: true, repeat: true }),
      env({ focus: onA }),
    );
    expect(effects).toEqual([
      { kind: 'move', ids: ['a'], dx: 0, dy: 24 * BIG_STEP_FACTOR, burst: true },
    ]);
  });

  it('moves the whole selection when the focused node is part of it', () => {
    const effects = effectsOf(
      BROWSE,
      key('ArrowLeft'),
      env({ focus: onA, selection: { nodes: ['a', 'b'], edges: [] } }),
    );
    expect(effects).toEqual([{ kind: 'move', ids: ['a', 'b'], dx: -24, dy: 0, burst: false }]);
  });

  it('moves only the focused node when it is outside the selection', () => {
    const effects = effectsOf(
      BROWSE,
      key('ArrowLeft'),
      env({ focus: onA, selection: { nodes: ['b'], edges: [] } }),
    );
    expect(effects).toEqual([{ kind: 'move', ids: ['a'], dx: -24, dy: 0, burst: false }]);
  });

  it('moves the selection when nothing is focused', () => {
    const effects = effectsOf(
      BROWSE,
      key('ArrowRight'),
      env({ selection: { nodes: ['b'], edges: [] } }),
    );
    expect(effects).toEqual([{ kind: 'move', ids: ['b'], dx: 24, dy: 0, burst: false }]);
  });

  it('pans the view with the arrows when nothing is focused or selected', () => {
    expect(effectsOf(BROWSE, key('ArrowRight'), env())).toEqual([
      { kind: 'panView', dx: VIEW_PAN_STEP, dy: 0 },
    ]);
    expect(effectsOf(BROWSE, key('ArrowUp', { shift: true }), env())).toEqual([
      { kind: 'panView', dx: 0, dy: -VIEW_PAN_STEP * BIG_STEP_FACTOR },
    ]);
  });

  it('pans the view instead of moving anything when an edge is focused', () => {
    const focus: FocusTarget = { kind: 'edge', id: 'e1' };
    expect(effectsOf(BROWSE, key('ArrowRight'), env({ focus }))).toEqual([
      { kind: 'panView', dx: VIEW_PAN_STEP, dy: 0 },
    ]);
  });

  it('moves focus to the nearest node with alt and an arrow', () => {
    expect(effectsOf(BROWSE, key('ArrowRight', { alt: true }), env({ focus: onA }))).toEqual([
      { kind: 'focus', target: { kind: 'node', id: 'b' } },
    ]);
    expect(effectsOf(BROWSE, key('ArrowDown', { alt: true }), env({ focus: onA }))).toEqual([
      { kind: 'focus', target: { kind: 'node', id: 'c' } },
    ]);
  });

  it('does nothing when no node lies in that direction', () => {
    const outcome = reduceKey(BROWSE, key('ArrowLeft', { alt: true }), env({ focus: onA }));
    expect(outcome.effects).toEqual([]);
    expect(outcome.handled).toBe(true);
  });

  it('starts at the first node when alt and an arrow are pressed with no focus', () => {
    expect(effectsOf(BROWSE, key('ArrowRight', { alt: true }), env())).toEqual([
      { kind: 'focus', target: { kind: 'node', id: 'a' } },
    ]);
  });

  it('walks nodes in reading order and then edges with N and P', () => {
    expect(effectsOf(BROWSE, key('n'), env({ focus: onA }))).toEqual([
      { kind: 'focus', target: { kind: 'node', id: 'b' } },
    ]);
    expect(effectsOf(BROWSE, key('N'), env({ focus: { kind: 'node', id: 'c' } }))).toEqual([
      { kind: 'focus', target: { kind: 'edge', id: 'e1' } },
    ]);
    expect(effectsOf(BROWSE, key('p'), env({ focus: onA }))).toEqual([
      { kind: 'focus', target: { kind: 'edge', id: 'e2' } },
    ]);
  });

  it('does nothing for N when the diagram is empty', () => {
    const empty = env({ nodeOrder: () => [], edgeOrder: () => [] });
    const outcome = reduceKey(BROWSE, key('n'), empty);
    expect(outcome.effects).toEqual([]);
    expect(outcome.handled).toBe(true);
  });

  it('opens the label editor with Enter or F2 on a node', () => {
    expect(effectsOf(BROWSE, key('Enter'), env({ focus: onA }))).toEqual([
      { kind: 'editLabel', id: 'a' },
    ]);
    expect(effectsOf(BROWSE, key('F2'), env({ selection: { nodes: ['b'], edges: [] } }))).toEqual([
      { kind: 'editLabel', id: 'b' },
    ]);
  });

  it('leaves Enter alone when there is no node to edit', () => {
    expect(reduceKey(BROWSE, key('Enter'), env()).handled).toBe(false);
    expect(
      reduceKey(BROWSE, key('Enter'), env({ focus: { kind: 'edge', id: 'e1' } })).handled,
    ).toBe(false);
  });

  it('deletes with Delete or Backspace only when something is focused or selected', () => {
    expect(effectsOf(BROWSE, key('Delete'), env({ focus: onA }))).toEqual([
      { kind: 'deleteSubject' },
    ]);
    expect(
      effectsOf(BROWSE, key('Backspace'), env({ selection: { nodes: [], edges: ['e1'] } })),
    ).toEqual([{ kind: 'deleteSubject' }]);
    expect(reduceKey(BROWSE, key('Delete'), env()).handled).toBe(false);
  });

  it('undoes and redoes with the usual shortcuts', () => {
    expect(effectsOf(BROWSE, key('z', { ctrl: true }), env())).toEqual([{ kind: 'undo' }]);
    expect(effectsOf(BROWSE, key('Z', { meta: true, shift: true }), env())).toEqual([
      { kind: 'redo' },
    ]);
    expect(effectsOf(BROWSE, key('y', { ctrl: true }), env())).toEqual([{ kind: 'redo' }]);
  });

  it('ignores other shortcuts with a modifier so the browser keeps them', () => {
    expect(reduceKey(BROWSE, key('c', { ctrl: true }), env({ focus: onA })).handled).toBe(false);
    expect(reduceKey(BROWSE, key('n', { alt: true }), env({ focus: onA })).handled).toBe(false);
  });

  it('opens the shortcuts dialog with a question mark and escapes with Escape', () => {
    expect(effectsOf(BROWSE, key('?', { shift: true }), env())).toEqual([{ kind: 'help' }]);
    expect(effectsOf(BROWSE, key('Escape'), env())).toEqual([{ kind: 'escape' }]);
  });

  it('leaves Tab and unknown keys to the browser', () => {
    expect(reduceKey(BROWSE, key('Tab'), env()).handled).toBe(false);
    expect(reduceKey(BROWSE, key('x'), env()).handled).toBe(false);
    expect(reduceKey(BROWSE, key('Home'), env()).handled).toBe(false);
  });
});

describe('connect mode', () => {
  const connecting: KeyMode = { kind: 'connect', sourceId: 'a', candidate: undefined };

  it('starts from the focused node and announces what to do', () => {
    const outcome = reduceKey(BROWSE, key('c'), env({ focus: onA }));
    expect(outcome.mode).toEqual(connecting);
    expect(outcome.effects).toEqual([
      { kind: 'previewConnect', sourceId: 'a', targetId: undefined },
      { kind: 'announce', text: CONNECT_PROMPT },
    ]);
  });

  it('asks for a focused node when there is none', () => {
    const outcome = reduceKey(BROWSE, key('c'), env());
    expect(outcome.mode).toBe(BROWSE);
    expect(outcome.effects).toEqual([
      { kind: 'announce', text: 'Focus a node first, then press C to connect it.' },
    ]);
    const onEdge = reduceKey(BROWSE, key('C'), env({ focus: { kind: 'edge', id: 'e1' } }));
    expect(onEdge.mode).toBe(BROWSE);
  });

  it('picks a target with an arrow key, starting from the source', () => {
    const outcome = reduceKey(connecting, key('ArrowRight'), env({ focus: onA }));
    expect(outcome.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'b' });
    expect(outcome.effects).toEqual([
      { kind: 'previewConnect', sourceId: 'a', targetId: 'b' },
      { kind: 'announce', text: 'Connect to name of b. Press Enter to confirm.' },
    ]);
  });

  it('continues from the current candidate on the next arrow key', () => {
    const atB: KeyMode = { kind: 'connect', sourceId: 'a', candidate: 'b' };
    const down = reduceKey(atB, key('ArrowDown'), env({ focus: onA }));
    expect(down.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'c' });
    const stuck = reduceKey(atB, key('ArrowRight'), env({ focus: onA }));
    expect(stuck.mode).toBe(atB);
    expect(stuck.effects).toEqual([]);
  });

  it('cycles through the other nodes with N and P and never offers the source', () => {
    const first = reduceKey(connecting, key('n'), env({ focus: onA }));
    expect(first.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'b' });
    const second = reduceKey(first.mode, key('n'), env({ focus: onA }));
    expect(second.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'c' });
    const third = reduceKey(second.mode, key('n'), env({ focus: onA }));
    expect(third.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'b' });
    const back = reduceKey(connecting, key('P'), env({ focus: onA }));
    expect(back.mode).toEqual({ kind: 'connect', sourceId: 'a', candidate: 'c' });
  });

  it('creates the edge on Enter once a target is chosen', () => {
    const chosen: KeyMode = { kind: 'connect', sourceId: 'a', candidate: 'b' };
    const outcome = reduceKey(chosen, key('Enter'), env({ focus: onA }));
    expect(outcome.mode).toBe(BROWSE);
    expect(outcome.effects).toEqual([{ kind: 'commitConnect', sourceId: 'a', targetId: 'b' }]);
  });

  it('asks for a target when Enter comes too early', () => {
    const outcome = reduceKey(connecting, key('Enter'), env({ focus: onA }));
    expect(outcome.mode).toEqual(connecting);
    expect(outcome.effects).toEqual([{ kind: 'announce', text: 'Choose a target first.' }]);
  });

  it('cancels on Escape and when focus leaves with Tab', () => {
    const escaped = reduceKey(connecting, key('Escape'), env({ focus: onA }));
    expect(escaped.mode).toBe(BROWSE);
    expect(escaped.effects).toEqual([
      { kind: 'cancelConnect' },
      { kind: 'announce', text: 'Connection cancelled.' },
    ]);
    const tabbed = reduceKey(connecting, key('Tab'), env({ focus: onA }));
    expect(tabbed.mode).toBe(BROWSE);
    expect(tabbed.handled).toBe(false);
    expect(tabbed.effects).toEqual([{ kind: 'cancelConnect' }]);
  });

  it('swallows other keys without leaving the mode and leaves shortcuts with modifiers alone', () => {
    const swallowed = reduceKey(connecting, key('x'), env({ focus: onA }));
    expect(swallowed.mode).toEqual(connecting);
    expect(swallowed.handled).toBe(true);
    expect(reduceKey(connecting, key('r', { ctrl: true }), env({ focus: onA })).handled).toBe(
      false,
    );
  });
});
