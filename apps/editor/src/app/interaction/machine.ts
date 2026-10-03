import {
  normalizeWheel,
  panBy,
  pinchViewport,
  rectFromCorners,
  screenToWorld,
  snapMovementToGrid,
  snapPointToGrid,
  zoomByFactorAround,
  type Vec2,
} from '@coschema/geometry';
import { DEFAULT_NODE_SIZES, type EdgeId, type NodeId } from '@coschema/model';
import {
  EMPTY_SELECTION,
  IDLE,
  type ConnectPreview,
  type DragNodes,
  type Effect,
  type InteractionEnv,
  type InteractionEvent,
  type InteractionState,
  type Marquee,
  type MovedNode,
  type PointerCancel,
  type PointerDown,
  type PointerMove,
  type PointerUp,
  type PressCanvas,
  type PressNode,
  type Selection,
  type SinglePointerState,
  type Transition,
  type WheelEvent,
  type Pinch,
} from './types';

const DRAG_THRESHOLD_PIXELS = 4;

const NO_EFFECTS: readonly Effect[] = [];

interface TrackedStart {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly last: Vec2;
}

function stay(state: InteractionState): Transition {
  return { state, effects: NO_EFFECTS };
}

function goto(state: InteractionState, ...effects: Effect[]): Transition {
  return { state, effects };
}

function movedPastThreshold(from: Vec2, to: Vec2): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) >= DRAG_THRESHOLD_PIXELS;
}

function selectionKey(selection: Selection): string {
  return `${[...selection.nodes].sort().join(',')}|${[...selection.edges].sort().join(',')}`;
}

function union(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function isSinglePointer(state: InteractionState): state is SinglePointerState {
  return state.mode !== 'idle' && state.mode !== 'pinch';
}

function cancelEffects(state: InteractionState): readonly Effect[] {
  switch (state.mode) {
    case 'dragNodes':
      return [{ kind: 'clearPreview' }];
    case 'marquee':
      return [
        { kind: 'marquee', rect: undefined },
        { kind: 'select', selection: state.base },
      ];
    case 'connect':
      return [{ kind: 'connectPreview', preview: undefined }];
    default:
      return NO_EFFECTS;
  }
}

function resolveConnectTarget(
  env: InteractionEnv,
  world: Vec2,
  sourceId: NodeId,
): ConnectPreview['target'] {
  const hit = env.hitTest(world);
  if (hit.kind === 'port' && hit.id !== sourceId) return { id: hit.id, port: hit.port };
  if (hit.kind === 'node' && hit.id !== sourceId) {
    const port = env.nearestPort(hit.id, world);
    return port === undefined ? undefined : { id: hit.id, port };
  }
  return undefined;
}

function pointerDownWhileBusy(
  state: InteractionState,
  event: PointerDown,
  env: InteractionEnv,
): Transition {
  if (
    event.pointerType !== 'touch' ||
    !isSinglePointer(state) ||
    state.pointerType !== 'touch' ||
    state.pointerId === event.pointerId
  ) {
    return stay(state);
  }
  const first = { id: state.pointerId, screen: state.last };
  const second = { id: event.pointerId, screen: event.screen };
  const pinch: Pinch = {
    mode: 'pinch',
    first,
    second,
    startViewport: env.viewport,
    startFirst: first.screen,
    startSecond: second.screen,
  };
  return goto(pinch, ...cancelEffects(state));
}

function toggledEdge(selection: Selection, id: EdgeId): Selection {
  const present = selection.edges.includes(id);
  return {
    nodes: selection.nodes,
    edges: present ? selection.edges.filter((edge) => edge !== id) : [...selection.edges, id],
  };
}

function createNodeAt(env: InteractionEnv, world: Vec2): Transition {
  const tool = env.tool;
  if (tool === 'select' || tool === 'hand') return stay(IDLE);
  const [width, height] = DEFAULT_NODE_SIZES[tool];
  const corner: Vec2 = [world[0] - width / 2, world[1] - height / 2];
  const position = env.snap.enabled ? snapPointToGrid(corner, env.snap.gridSize) : corner;
  return goto(IDLE, { kind: 'createNode', nodeType: tool, position });
}

function pressNode(
  env: InteractionEnv,
  tracked: TrackedStart,
  nodeId: NodeId,
  startScreen: Vec2,
  additive: boolean,
): Transition {
  const selected = env.selection.nodes.includes(nodeId);
  const effects: Effect[] = [];
  let nodes = env.selection.nodes;
  let deferred: PressNode['deferred'] = 'none';
  if (!selected) {
    nodes = additive ? [...env.selection.nodes, nodeId] : [nodeId];
    effects.push({
      kind: 'select',
      selection: { nodes, edges: additive ? env.selection.edges : [] },
    });
  } else if (additive) {
    deferred = 'toggleOff';
  } else if (env.selection.nodes.length > 1 || env.selection.edges.length > 0) {
    deferred = 'collapse';
  }
  return goto({ mode: 'pressNode', ...tracked, nodeId, nodes, startScreen, deferred }, ...effects);
}

function pointerDownIdle(event: PointerDown, env: InteractionEnv): Transition {
  const tracked: TrackedStart = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    last: event.screen,
  };
  if (event.button === 1 || (event.button === 0 && (event.space || env.tool === 'hand'))) {
    return stay({ mode: 'pan', ...tracked });
  }
  if (event.button !== 0) return stay(IDLE);
  const world = screenToWorld(env.viewport, event.screen);
  if (env.tool !== 'select') return createNodeAt(env, world);
  const additive = event.shift || event.toggle;
  const hit = env.hitTest(world);
  switch (hit.kind) {
    case 'port':
      return goto(
        { mode: 'connect', ...tracked, sourceId: hit.id, sourcePort: hit.port, target: undefined },
        {
          kind: 'connectPreview',
          preview: { sourceId: hit.id, sourcePort: hit.port, pointer: world, target: undefined },
        },
      );
    case 'node':
      return pressNode(env, tracked, hit.id, event.screen, additive);
    case 'edge':
      return goto(IDLE, {
        kind: 'select',
        selection: additive ? toggledEdge(env.selection, hit.id) : { nodes: [], edges: [hit.id] },
      });
    case 'canvas':
      return stay({
        mode: 'pressCanvas',
        ...tracked,
        startScreen: event.screen,
        additive,
        base: additive ? env.selection : EMPTY_SELECTION,
      });
  }
}

function dragMoves(state: DragNodes, delta: Vec2): MovedNode[] {
  return state.origins.map((origin) => ({
    id: origin.id,
    pos: [origin.rect.x + delta[0], origin.rect.y + delta[1]],
  }));
}

function dragDelta(state: DragNodes, screen: Vec2, env: InteractionEnv): Vec2 {
  const zoom = env.viewport.zoom;
  const raw: Vec2 = [
    (screen[0] - state.startScreen[0]) / zoom,
    (screen[1] - state.startScreen[1]) / zoom,
  ];
  if (!env.snap.enabled) return raw;
  return snapMovementToGrid(
    state.origins.map((origin) => origin.rect),
    raw,
    env.snap.gridSize,
  );
}

function continueDrag(state: DragNodes, screen: Vec2, env: InteractionEnv): Transition {
  const delta = dragDelta(state, screen, env);
  const next: DragNodes = { ...state, last: screen, delta };
  if (delta[0] === state.delta[0] && delta[1] === state.delta[1]) return stay(next);
  return goto(next, { kind: 'previewMove', moves: dragMoves(next, delta) });
}

function beginDrag(state: PressNode, screen: Vec2, env: InteractionEnv): Transition {
  const origins = state.nodes.flatMap((id) => {
    const rect = env.nodeRect(id);
    return rect === undefined ? [] : [{ id, rect }];
  });
  if (origins.length === 0) return stay(IDLE);
  const drag: DragNodes = {
    mode: 'dragNodes',
    pointerId: state.pointerId,
    pointerType: state.pointerType,
    last: screen,
    startScreen: state.startScreen,
    origins,
    delta: [0, 0],
  };
  return continueDrag(drag, screen, env);
}

function updateMarquee(state: Marquee, screen: Vec2, env: InteractionEnv): Transition {
  const rect = rectFromCorners(state.startWorld, screenToWorld(env.viewport, screen));
  const hits = env.nodesIntersecting(rect);
  const selection: Selection = state.additive
    ? { nodes: union(state.base.nodes, hits), edges: state.base.edges }
    : { nodes: [...hits], edges: [] };
  const key = selectionKey(selection);
  const effects: Effect[] = [{ kind: 'marquee', rect }];
  if (key !== state.lastKey) effects.push({ kind: 'select', selection });
  return goto({ ...state, last: screen, lastKey: key }, ...effects);
}

function leavePressCanvas(state: PressCanvas, screen: Vec2, env: InteractionEnv): Transition {
  if (state.pointerType === 'touch') {
    const viewport = panBy(env.viewport, [
      screen[0] - state.startScreen[0],
      screen[1] - state.startScreen[1],
    ]);
    return goto(
      { mode: 'pan', pointerId: state.pointerId, pointerType: state.pointerType, last: screen },
      { kind: 'viewport', viewport },
    );
  }
  const marquee: Marquee = {
    mode: 'marquee',
    pointerId: state.pointerId,
    pointerType: state.pointerType,
    last: screen,
    startWorld: screenToWorld(env.viewport, state.startScreen),
    additive: state.additive,
    base: state.base,
    lastKey: selectionKey(state.base),
  };
  return updateMarquee(marquee, screen, env);
}

function movePinch(state: Pinch, event: PointerMove): Transition {
  let { first, second } = state;
  if (event.pointerId === first.id) first = { id: first.id, screen: event.screen };
  else if (event.pointerId === second.id) second = { id: second.id, screen: event.screen };
  else return stay(state);
  const viewport = pinchViewport(
    state.startViewport,
    [state.startFirst, state.startSecond],
    [first.screen, second.screen],
  );
  return goto({ ...state, first, second }, { kind: 'viewport', viewport });
}

function pointerMove(state: InteractionState, event: PointerMove, env: InteractionEnv): Transition {
  if (state.mode === 'pinch') return movePinch(state, event);
  if (state.mode === 'idle' || state.pointerId !== event.pointerId) return stay(state);
  const screen = event.screen;
  switch (state.mode) {
    case 'pressNode':
      return movedPastThreshold(state.startScreen, screen)
        ? beginDrag(state, screen, env)
        : stay({ ...state, last: screen });
    case 'dragNodes':
      return continueDrag(state, screen, env);
    case 'pressCanvas':
      return movedPastThreshold(state.startScreen, screen)
        ? leavePressCanvas(state, screen, env)
        : stay({ ...state, last: screen });
    case 'marquee':
      return updateMarquee(state, screen, env);
    case 'pan':
      return goto(
        { ...state, last: screen },
        {
          kind: 'viewport',
          viewport: panBy(env.viewport, [screen[0] - state.last[0], screen[1] - state.last[1]]),
        },
      );
    case 'connect': {
      const world = screenToWorld(env.viewport, screen);
      const target = resolveConnectTarget(env, world, state.sourceId);
      return goto(
        { ...state, last: screen, target },
        {
          kind: 'connectPreview',
          preview: {
            sourceId: state.sourceId,
            sourcePort: state.sourcePort,
            pointer: world,
            target,
          },
        },
      );
    }
  }
}

function releaseNode(state: PressNode): Transition {
  if (state.deferred === 'toggleOff') {
    return goto(IDLE, {
      kind: 'select',
      selection: { nodes: state.nodes.filter((id) => id !== state.nodeId), edges: [] },
    });
  }
  if (state.deferred === 'collapse') {
    return goto(IDLE, { kind: 'select', selection: { nodes: [state.nodeId], edges: [] } });
  }
  return stay(IDLE);
}

function releaseCanvas(state: PressCanvas, env: InteractionEnv): Transition {
  const nothingSelected = env.selection.nodes.length === 0 && env.selection.edges.length === 0;
  if (state.additive || nothingSelected) return stay(IDLE);
  return goto(IDLE, { kind: 'select', selection: EMPTY_SELECTION });
}

function releaseDrag(state: DragNodes): Transition {
  const moved = state.delta[0] !== 0 || state.delta[1] !== 0;
  const effects: Effect[] = moved
    ? [{ kind: 'commitMove', moves: dragMoves(state, state.delta) }]
    : [];
  effects.push({ kind: 'clearPreview' });
  return goto(IDLE, ...effects);
}

function releaseConnect(
  state: Extract<SinglePointerState, { mode: 'connect' }>,
  event: PointerUp,
  env: InteractionEnv,
): Transition {
  const target = resolveConnectTarget(
    env,
    screenToWorld(env.viewport, event.screen),
    state.sourceId,
  );
  const effects: Effect[] = [];
  if (target !== undefined) {
    effects.push({
      kind: 'connect',
      sourceId: state.sourceId,
      sourcePort: state.sourcePort,
      targetId: target.id,
      targetPort: target.port,
    });
  }
  effects.push({ kind: 'connectPreview', preview: undefined });
  return goto(IDLE, ...effects);
}

function pointerUp(state: InteractionState, event: PointerUp, env: InteractionEnv): Transition {
  if (state.mode === 'pinch') {
    const involved = event.pointerId === state.first.id || event.pointerId === state.second.id;
    return stay(involved ? IDLE : state);
  }
  if (state.mode === 'idle' || state.pointerId !== event.pointerId) return stay(state);
  switch (state.mode) {
    case 'pressNode':
      return releaseNode(state);
    case 'dragNodes':
      return releaseDrag(state);
    case 'pressCanvas':
      return releaseCanvas(state, env);
    case 'marquee':
      return goto(IDLE, { kind: 'marquee', rect: undefined });
    case 'pan':
      return stay(IDLE);
    case 'connect':
      return releaseConnect(state, event, env);
  }
}

function pointerCancel(state: InteractionState, event: PointerCancel): Transition {
  if (state.mode === 'idle') return stay(state);
  if (state.mode === 'pinch') {
    const involved = event.pointerId === state.first.id || event.pointerId === state.second.id;
    return stay(involved ? IDLE : state);
  }
  if (state.pointerId !== event.pointerId) return stay(state);
  return goto(IDLE, ...cancelEffects(state));
}

function wheel(state: InteractionState, event: WheelEvent, env: InteractionEnv): Transition {
  if (state.mode !== 'idle' && state.mode !== 'pan') return stay(state);
  const action = normalizeWheel(event, event.pageSize);
  const viewport =
    action.kind === 'zoom'
      ? zoomByFactorAround(env.viewport, event.screen, action.factor)
      : panBy(env.viewport, action.delta);
  return goto(state, { kind: 'viewport', viewport });
}

export function reduce(
  state: InteractionState,
  event: InteractionEvent,
  env: InteractionEnv,
): Transition {
  switch (event.type) {
    case 'pointerdown':
      return state.mode === 'idle'
        ? pointerDownIdle(event, env)
        : pointerDownWhileBusy(state, event, env);
    case 'pointermove':
      return pointerMove(state, event, env);
    case 'pointerup':
      return pointerUp(state, event, env);
    case 'pointercancel':
      return pointerCancel(state, event);
    case 'wheel':
      return wheel(state, event, env);
    case 'cancel':
      return goto(IDLE, ...cancelEffects(state));
  }
}
