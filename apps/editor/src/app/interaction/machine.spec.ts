import { zoomAround, type Rect, type Vec2, type Viewport } from '@coschema/geometry';
import { portAnchor, type NodeId, type PortId } from '@coschema/model';
import { describe, expect, it } from 'vitest';
import { reduce } from './machine';
import {
  EMPTY_SELECTION,
  IDLE,
  type Effect,
  type Hit,
  type InteractionEnv,
  type InteractionEvent,
  type InteractionState,
  type Selection,
} from './types';

const NODES: Readonly<Record<NodeId, Rect>> = {
  a: { x: 0, y: 0, width: 100, height: 60 },
  b: { x: 300, y: 0, width: 100, height: 60 },
  c: { x: 0, y: 200, width: 100, height: 60 },
};

function contains(rect: Rect, point: Vec2): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

interface EnvOptions {
  readonly viewport?: Viewport;
  readonly tool?: InteractionEnv['tool'];
  readonly selection?: Selection;
  readonly snap?: boolean;
  readonly edgeAt?: Vec2;
  readonly portAt?: { readonly point: Vec2; readonly id: NodeId; readonly port: PortId };
}

function makeEnv(options: EnvOptions = {}): InteractionEnv {
  return {
    viewport: options.viewport ?? { x: 0, y: 0, zoom: 1 },
    tool: options.tool ?? 'select',
    selection: options.selection ?? EMPTY_SELECTION,
    snap: { enabled: options.snap ?? false, gridSize: 8 },
    hitTest: (world): Hit => {
      const port = options.portAt;
      if (
        port !== undefined &&
        Math.hypot(world[0] - port.point[0], world[1] - port.point[1]) < 6
      ) {
        return { kind: 'port', id: port.id, port: port.port };
      }
      for (const [id, rect] of Object.entries(NODES)) {
        if (contains(rect, world)) return { kind: 'node', id };
      }
      const edge = options.edgeAt;
      if (edge !== undefined && Math.hypot(world[0] - edge[0], world[1] - edge[1]) < 6) {
        return { kind: 'edge', id: 'edge-1' };
      }
      return { kind: 'canvas' };
    },
    nodeRect: (id) => NODES[id],
    nodesIntersecting: (area) =>
      Object.entries(NODES)
        .filter(
          ([, rect]) =>
            rect.x <= area.x + area.width &&
            area.x <= rect.x + rect.width &&
            rect.y <= area.y + area.height &&
            area.y <= rect.y + rect.height,
        )
        .map(([id]) => id),
    nearestPort: (id, world) => {
      const rect = NODES[id];
      if (rect === undefined) return undefined;
      const ports: PortId[] = ['n', 'e', 's', 'w'];
      return ports
        .map((port) => ({
          port,
          distance: Math.hypot(
            portAnchor([rect.x, rect.y], [rect.width, rect.height], port)[0] - world[0],
            portAnchor([rect.x, rect.y], [rect.width, rect.height], port)[1] - world[1],
          ),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.port;
    },
  };
}

interface Run {
  state: InteractionState;
  effects: Effect[];
}

function play(
  events: readonly InteractionEvent[],
  env: InteractionEnv = makeEnv(),
  start: InteractionState = IDLE,
): Run {
  const run: Run = { state: start, effects: [] };
  for (const event of events) {
    const next = reduce(run.state, event, env);
    run.state = next.state;
    run.effects.push(...next.effects);
  }
  return run;
}

function down(
  screen: Vec2,
  extra: Partial<Extract<InteractionEvent, { type: 'pointerdown' }>> = {},
): InteractionEvent {
  return {
    type: 'pointerdown',
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    screen,
    shift: false,
    toggle: false,
    space: false,
    ...extra,
  };
}

function move(screen: Vec2, pointerId = 1): InteractionEvent {
  return { type: 'pointermove', pointerId, screen };
}

function up(screen: Vec2, pointerId = 1): InteractionEvent {
  return { type: 'pointerup', pointerId, screen };
}

function ofKind<Kind extends Effect['kind']>(
  effects: readonly Effect[],
  kind: Kind,
): Extract<Effect, { kind: Kind }>[] {
  return effects.filter(
    (effect): effect is Extract<Effect, { kind: Kind }> => effect.kind === kind,
  );
}

describe('selecting', () => {
  it('selects the node under a press', () => {
    const run = play([down([50, 30]), up([50, 30])]);
    expect(ofKind(run.effects, 'select')).toEqual([
      { kind: 'select', selection: { nodes: ['a'], edges: [] } },
    ]);
    expect(run.state.mode).toBe('idle');
  });

  it('adds to the selection with shift', () => {
    const env = makeEnv({ selection: { nodes: ['a'], edges: [] } });
    const run = play([down([350, 30], { shift: true }), up([350, 30])], env);
    expect(ofKind(run.effects, 'select')).toEqual([
      { kind: 'select', selection: { nodes: ['a', 'b'], edges: [] } },
    ]);
  });

  it('removes a selected node with shift only on release, so a drag keeps the group', () => {
    const env = makeEnv({ selection: { nodes: ['a', 'b'], edges: [] } });
    const pressed = play([down([50, 30], { shift: true })], env);
    expect(pressed.effects).toEqual([]);
    const released = play([up([50, 30])], env, pressed.state);
    expect(ofKind(released.effects, 'select')).toEqual([
      { kind: 'select', selection: { nodes: ['b'], edges: [] } },
    ]);
    const dragged = play([down([50, 30], { shift: true }), move([90, 30]), up([90, 30])], env);
    expect(ofKind(dragged.effects, 'select')).toEqual([]);
    expect(ofKind(dragged.effects, 'commitMove')).toHaveLength(1);
  });

  it('treats ctrl like shift', () => {
    const env = makeEnv({ selection: { nodes: ['a'], edges: [] } });
    const run = play([down([350, 30], { toggle: true }), up([350, 30])], env);
    expect(ofKind(run.effects, 'select')[0]?.selection.nodes).toEqual(['a', 'b']);
  });

  it('collapses a multi selection to the pressed node when released without a drag', () => {
    const env = makeEnv({ selection: { nodes: ['a', 'b'], edges: [] } });
    const run = play([down([50, 30]), up([50, 30])], env);
    expect(ofKind(run.effects, 'select')).toEqual([
      { kind: 'select', selection: { nodes: ['a'], edges: [] } },
    ]);
  });

  it('keeps the selection when a selected node is pressed alone', () => {
    const env = makeEnv({ selection: { nodes: ['a'], edges: [] } });
    const run = play([down([50, 30]), up([50, 30])], env);
    expect(run.effects).toEqual([]);
  });

  it('clears the selection on an empty press and keeps it with shift', () => {
    const env = makeEnv({ selection: { nodes: ['a'], edges: [] } });
    const cleared = play([down([600, 400]), up([600, 400])], env);
    expect(ofKind(cleared.effects, 'select')).toEqual([
      { kind: 'select', selection: EMPTY_SELECTION },
    ]);
    const kept = play([down([600, 400], { shift: true }), up([600, 400])], env);
    expect(kept.effects).toEqual([]);
    const nothing = play([down([600, 400]), up([600, 400])]);
    expect(nothing.effects).toEqual([]);
  });

  it('selects an edge and toggles edges with shift', () => {
    const env = makeEnv({ edgeAt: [600, 400] });
    const first = play([down([600, 400])], env);
    expect(ofKind(first.effects, 'select')).toEqual([
      { kind: 'select', selection: { nodes: [], edges: ['edge-1'] } },
    ]);
    const selected = makeEnv({
      edgeAt: [600, 400],
      selection: { nodes: ['a'], edges: ['edge-1'] },
    });
    const toggled = play([down([600, 400], { shift: true })], selected);
    expect(ofKind(toggled.effects, 'select')[0]?.selection).toEqual({ nodes: ['a'], edges: [] });
    const added = play(
      [down([600, 400], { shift: true })],
      makeEnv({ edgeAt: [600, 400], selection: { nodes: ['a'], edges: [] } }),
    );
    expect(ofKind(added.effects, 'select')[0]?.selection).toEqual({
      nodes: ['a'],
      edges: ['edge-1'],
    });
  });
});

describe('dragging', () => {
  it('does not start below the drag threshold', () => {
    const run = play([down([50, 30]), move([52, 31]), up([52, 31])]);
    expect(ofKind(run.effects, 'previewMove')).toEqual([]);
    expect(ofKind(run.effects, 'commitMove')).toEqual([]);
  });

  it('previews while moving and commits one move on release', () => {
    const run = play([down([50, 30]), move([70, 40]), move([90, 50]), up([90, 50])]);
    const previews = ofKind(run.effects, 'previewMove');
    expect(previews).toHaveLength(2);
    expect(previews[1]?.moves).toEqual([{ id: 'a', pos: [40, 20] }]);
    expect(ofKind(run.effects, 'commitMove')).toEqual([
      { kind: 'commitMove', moves: [{ id: 'a', pos: [40, 20] }] },
    ]);
    expect(run.effects.at(-1)).toEqual({ kind: 'clearPreview' });
    expect(run.state.mode).toBe('idle');
  });

  it('divides the pointer movement by the zoom', () => {
    const env = makeEnv({ viewport: { x: 0, y: 0, zoom: 2 } });
    const run = play([down([100, 60]), move([140, 60]), up([140, 60])], env);
    expect(ofKind(run.effects, 'commitMove')[0]?.moves).toEqual([{ id: 'a', pos: [20, 0] }]);
  });

  it('snaps the moved selection to the grid', () => {
    const env = makeEnv({ snap: true });
    const run = play([down([50, 30]), move([63, 41]), up([63, 41])], env);
    expect(ofKind(run.effects, 'commitMove')[0]?.moves).toEqual([{ id: 'a', pos: [16, 8] }]);
  });

  it('does not repeat a preview when the snapped delta is unchanged', () => {
    const env = makeEnv({ snap: true });
    const run = play([down([50, 30]), move([63, 41]), move([64, 41])], env);
    expect(ofKind(run.effects, 'previewMove')).toHaveLength(1);
  });

  it('moves a multi selection together and keeps the offsets', () => {
    const env = makeEnv({ selection: { nodes: ['a', 'b'], edges: [] } });
    const run = play([down([50, 30]), move([80, 30]), up([80, 30])], env);
    expect(ofKind(run.effects, 'commitMove')[0]?.moves).toEqual([
      { id: 'a', pos: [30, 0] },
      { id: 'b', pos: [330, 0] },
    ]);
  });

  it('commits nothing when the node is dragged back to where it started', () => {
    const run = play([down([50, 30]), move([90, 30]), move([50, 30]), up([50, 30])]);
    expect(ofKind(run.effects, 'commitMove')).toEqual([]);
    expect(run.effects.at(-1)).toEqual({ kind: 'clearPreview' });
  });

  it('abandons the drag when the node disappeared', () => {
    const env: InteractionEnv = { ...makeEnv(), nodeRect: () => undefined };
    const run = play([down([50, 30]), move([90, 30])], env);
    expect(run.state.mode).toBe('idle');
  });

  it('restores everything on escape and on pointer cancel', () => {
    const escaped = play([down([50, 30]), move([90, 30]), { type: 'cancel' }]);
    expect(escaped.effects.at(-1)).toEqual({ kind: 'clearPreview' });
    expect(ofKind(escaped.effects, 'commitMove')).toEqual([]);
    expect(escaped.state.mode).toBe('idle');
    const cancelled = play([
      down([50, 30]),
      move([90, 30]),
      { type: 'pointercancel', pointerId: 1 },
    ]);
    expect(cancelled.effects.at(-1)).toEqual({ kind: 'clearPreview' });
  });

  it('ignores other pointers while a drag is running', () => {
    const run = play([
      down([50, 30]),
      move([90, 30]),
      down([600, 400], { pointerId: 2 }),
      move([10, 10], 2),
      up([10, 10], 2),
      { type: 'pointercancel', pointerId: 2 },
    ]);
    expect(run.state.mode).toBe('dragNodes');
  });
});

describe('marquee', () => {
  it('selects the nodes the rectangle touches', () => {
    const run = play([down([-20, -20]), move([120, 80]), up([120, 80])]);
    expect(ofKind(run.effects, 'marquee')[0]?.rect).toEqual({
      x: -20,
      y: -20,
      width: 140,
      height: 100,
    });
    expect(ofKind(run.effects, 'select').at(-1)?.selection.nodes).toEqual(['a']);
    expect(run.effects.at(-1)).toEqual({ kind: 'marquee', rect: undefined });
  });

  it('selects across several nodes and only reports changes', () => {
    const run = play([down([-20, -20]), move([420, 80]), move([430, 85]), move([430, 300])]);
    const selections = ofKind(run.effects, 'select');
    expect(selections.map((effect) => [...effect.selection.nodes].sort())).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]);
  });

  it('extends the previous selection with shift', () => {
    const env = makeEnv({ selection: { nodes: ['c'], edges: [] } });
    const run = play([down([-20, -20], { shift: true }), move([120, 80])], env);
    expect(ofKind(run.effects, 'select').at(-1)?.selection.nodes).toEqual(['c', 'a']);
  });

  it('puts the previous selection back on escape', () => {
    const env = makeEnv({ selection: { nodes: ['c'], edges: [] } });
    const run = play([down([-20, -20], { shift: true }), move([120, 80]), { type: 'cancel' }], env);
    expect(run.effects.slice(-2)).toEqual([
      { kind: 'marquee', rect: undefined },
      { kind: 'select', selection: { nodes: ['c'], edges: [] } },
    ]);
  });
});

describe('connecting', () => {
  const portEnv = (extra: EnvOptions = {}): InteractionEnv =>
    makeEnv({ portAt: { point: [100, 30], id: 'a', port: 'e' }, ...extra });

  it('starts from a port and previews the line', () => {
    const run = play([down([100, 30])], portEnv());
    expect(run.state.mode).toBe('connect');
    expect(ofKind(run.effects, 'connectPreview')[0]?.preview).toEqual({
      sourceId: 'a',
      sourcePort: 'e',
      pointer: [100, 30],
      target: undefined,
    });
  });

  it('snaps the preview target to the nearest port of the node under the pointer', () => {
    const run = play([down([100, 30]), move([310, 30])], portEnv());
    expect(ofKind(run.effects, 'connectPreview').at(-1)?.preview?.target).toEqual({
      id: 'b',
      port: 'w',
    });
  });

  it('creates the edge when released over another node', () => {
    const run = play([down([100, 30]), move([310, 30]), up([310, 30])], portEnv());
    expect(ofKind(run.effects, 'connect')).toEqual([
      { kind: 'connect', sourceId: 'a', sourcePort: 'e', targetId: 'b', targetPort: 'w' },
    ]);
    expect(run.effects.at(-1)).toEqual({ kind: 'connectPreview', preview: undefined });
    expect(run.state.mode).toBe('idle');
  });

  it('uses a port hit on the target directly', () => {
    const env = makeEnv({ portAt: { point: [100, 30], id: 'a', port: 'e' } });
    const target: InteractionEnv = {
      ...env,
      hitTest: (world) =>
        world[0] > 290 ? { kind: 'port', id: 'b', port: 'n' } : env.hitTest(world),
    };
    const run = play([down([100, 30]), up([350, 0])], target);
    expect(ofKind(run.effects, 'connect')[0]).toMatchObject({ targetId: 'b', targetPort: 'n' });
  });

  it('connects nothing when released on empty canvas or on the source node', () => {
    const empty = play([down([100, 30]), move([600, 400]), up([600, 400])], portEnv());
    expect(ofKind(empty.effects, 'connect')).toEqual([]);
    const self = play([down([100, 30]), move([50, 30]), up([50, 30])], portEnv());
    expect(ofKind(self.effects, 'connect')).toEqual([]);
  });

  it('cancels with escape', () => {
    const run = play([down([100, 30]), move([310, 30]), { type: 'cancel' }], portEnv());
    expect(run.effects.at(-1)).toEqual({ kind: 'connectPreview', preview: undefined });
    expect(run.state.mode).toBe('idle');
  });
});

describe('panning', () => {
  it('pans with the middle button', () => {
    const run = play([down([100, 100], { button: 1 }), move([130, 90]), up([130, 90])]);
    expect(ofKind(run.effects, 'viewport')[0]?.viewport).toEqual({ x: 30, y: -10, zoom: 1 });
    expect(run.state.mode).toBe('idle');
  });

  it('pans with space held and with the hand tool', () => {
    const spaced = play([down([100, 100], { space: true }), move([110, 100])]);
    expect(ofKind(spaced.effects, 'viewport')).toHaveLength(1);
    const hand = play([down([50, 30]), move([60, 30])], makeEnv({ tool: 'hand' }));
    expect(ofKind(hand.effects, 'viewport')).toHaveLength(1);
    expect(ofKind(hand.effects, 'select')).toEqual([]);
  });

  it('accumulates pan steps from the latest viewport', () => {
    let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    let state: InteractionState = IDLE;
    for (const event of [down([0, 0], { button: 1 }), move([10, 0]), move([25, 5])]) {
      const next = reduce(state, event, makeEnv({ viewport }));
      state = next.state;
      for (const effect of next.effects) if (effect.kind === 'viewport') viewport = effect.viewport;
    }
    expect(viewport).toEqual({ x: 25, y: 5, zoom: 1 });
  });

  it('pans with one finger on empty canvas but selects a node under the finger', () => {
    const run = play([
      down([600, 400], { pointerType: 'touch' }),
      move([601, 400]),
      move([640, 420]),
      move([650, 420]),
      up([650, 420]),
    ]);
    expect(ofKind(run.effects, 'viewport')[0]?.viewport).toEqual({ x: 40, y: 20, zoom: 1 });
    expect(ofKind(run.effects, 'marquee')).toEqual([]);
    const onNode = play([down([50, 30], { pointerType: 'touch' }), move([90, 30])]);
    expect(ofKind(onNode.effects, 'previewMove')).toHaveLength(1);
  });

  it('ignores the right button', () => {
    const run = play([down([50, 30], { button: 2 })]);
    expect(run.effects).toEqual([]);
    expect(run.state.mode).toBe('idle');
  });
});

describe('pinching', () => {
  const touch = (pointerId: number, screen: Vec2): InteractionEvent =>
    down(screen, { pointerId, pointerType: 'touch' });

  it('zooms around the midpoint of two fingers', () => {
    const run = play([
      touch(1, [400, 300]),
      touch(2, [600, 300]),
      move([300, 300], 1),
      move([700, 300], 2),
    ]);
    expect(run.state.mode).toBe('pinch');
    const viewport = ofKind(run.effects, 'viewport').at(-1)?.viewport;
    expect(viewport?.zoom).toBeCloseTo(2);
    const anchored = zoomAround({ x: 0, y: 0, zoom: 1 }, [500, 300], 2);
    expect(viewport?.x).toBeCloseTo(anchored.x);
    expect(viewport?.y).toBeCloseTo(anchored.y);
  });

  it('drops a running node drag when the second finger lands', () => {
    const run = play([touch(1, [50, 30]), move([90, 30], 1), touch(2, [600, 300])]);
    expect(run.state.mode).toBe('pinch');
    expect(run.effects.at(-1)).toEqual({ kind: 'clearPreview' });
    expect(ofKind(run.effects, 'commitMove')).toEqual([]);
  });

  it('ends when either finger lifts or is cancelled', () => {
    const base = [touch(1, [400, 300]), touch(2, [600, 300])];
    expect(play([...base, up([400, 300], 1)]).state.mode).toBe('idle');
    expect(play([...base, up([600, 300], 2)]).state.mode).toBe('idle');
    expect(play([...base, { type: 'pointercancel', pointerId: 2 }]).state.mode).toBe('idle');
    expect(play([...base, up([1, 1], 3)]).state.mode).toBe('pinch');
    expect(play([...base, { type: 'pointercancel', pointerId: 3 }]).state.mode).toBe('pinch');
    expect(play([...base, move([1, 1], 3)]).state.mode).toBe('pinch');
    expect(play([...base, { type: 'cancel' }]).state.mode).toBe('idle');
    expect(play([...base, touch(3, [1, 1])]).state.mode).toBe('pinch');
  });

  it('does not pinch with a mouse or with the same touch twice', () => {
    const mouse = play([down([50, 30]), down([600, 300], { pointerId: 2, pointerType: 'touch' })]);
    expect(mouse.state.mode).toBe('pressNode');
    const twice = play([touch(1, [50, 30]), touch(1, [60, 30])]);
    expect(twice.state.mode).toBe('pressNode');
  });
});

describe('wheel', () => {
  const wheel = (
    extra: Partial<Extract<InteractionEvent, { type: 'wheel' }>>,
  ): InteractionEvent => ({
    type: 'wheel',
    screen: [200, 100],
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    pageSize: 800,
    ...extra,
  });

  it('pans by the scroll amount', () => {
    const run = play([wheel({ deltaX: 10, deltaY: 40 })]);
    expect(ofKind(run.effects, 'viewport')[0]?.viewport).toEqual({ x: -10, y: -40, zoom: 1 });
  });

  it('zooms around the cursor with ctrl, which is how a trackpad pinch arrives', () => {
    const run = play([wheel({ deltaY: -50, ctrlKey: true })]);
    const viewport = ofKind(run.effects, 'viewport')[0]?.viewport;
    expect(viewport?.zoom).toBeGreaterThan(1);
    const world: Vec2 = [
      (200 - (viewport?.x ?? 0)) / (viewport?.zoom ?? 1),
      (100 - (viewport?.y ?? 0)) / (viewport?.zoom ?? 1),
    ];
    expect(world[0]).toBeCloseTo(200);
    expect(world[1]).toBeCloseTo(100);
  });

  it('is ignored while a node is being dragged', () => {
    const dragging = play([down([50, 30]), move([90, 30])]);
    const run = play([wheel({ deltaY: 40 })], makeEnv(), dragging.state);
    expect(run.effects).toEqual([]);
  });

  it('works while panning', () => {
    const panning = play([down([0, 0], { button: 1 })]);
    const run = play([wheel({ deltaY: 40 })], makeEnv(), panning.state);
    expect(ofKind(run.effects, 'viewport')).toHaveLength(1);
  });
});

describe('creating', () => {
  it('places the chosen shape centred on the click and snapped to the grid', () => {
    const run = play([down([203, 101])], makeEnv({ tool: 'rect', snap: true }));
    expect(run.effects).toEqual([{ kind: 'createNode', nodeType: 'rect', position: [144, 72] }]);
  });

  it('places without snapping when snapping is off, even over an existing node', () => {
    const run = play([down([50, 30])], makeEnv({ tool: 'ellipse' }));
    expect(run.effects).toEqual([{ kind: 'createNode', nodeType: 'ellipse', position: [-10, -6] }]);
  });
});

describe('stray events', () => {
  it('ignores moves and releases while idle', () => {
    expect(
      play([move([1, 1]), up([1, 1]), { type: 'pointercancel', pointerId: 1 }, { type: 'cancel' }])
        .effects,
    ).toEqual([]);
  });

  it('keeps tracking a press that has not moved far enough', () => {
    const pressed = play([down([50, 30]), move([51, 30])]);
    expect(pressed.state.mode).toBe('pressNode');
    const canvas = play([down([600, 400]), move([601, 400])]);
    expect(canvas.state.mode).toBe('pressCanvas');
    const other = play([down([600, 400]), move([700, 400], 9), up([700, 400], 9)]);
    expect(other.state.mode).toBe('pressCanvas');
  });
});
