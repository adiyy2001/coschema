import type { Rect, Vec2, Viewport } from '@coschema/geometry';
import type { EdgeId, NodeId, NodeType, PortId } from '@coschema/model';

export type Tool = 'select' | 'hand' | NodeType;

export type Hit =
  | { readonly kind: 'canvas' }
  | { readonly kind: 'node'; readonly id: NodeId }
  | { readonly kind: 'port'; readonly id: NodeId; readonly port: PortId }
  | { readonly kind: 'edge'; readonly id: EdgeId };

export interface Selection {
  readonly nodes: readonly NodeId[];
  readonly edges: readonly EdgeId[];
}

export const EMPTY_SELECTION: Selection = { nodes: [], edges: [] };

export interface SnapSettings {
  readonly enabled: boolean;
  readonly gridSize: number;
}

export interface InteractionEnv {
  readonly viewport: Viewport;
  readonly tool: Tool;
  readonly selection: Selection;
  readonly snap: SnapSettings;
  hitTest(world: Vec2): Hit;
  nodeRect(id: NodeId): Rect | undefined;
  nodesIntersecting(area: Rect): readonly NodeId[];
  nearestPort(id: NodeId, world: Vec2): PortId | undefined;
}

export interface PointerDown {
  readonly type: 'pointerdown';
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly screen: Vec2;
  readonly shift: boolean;
  readonly toggle: boolean;
  readonly space: boolean;
}

export interface PointerMove {
  readonly type: 'pointermove';
  readonly pointerId: number;
  readonly screen: Vec2;
}

export interface PointerUp {
  readonly type: 'pointerup';
  readonly pointerId: number;
  readonly screen: Vec2;
}

export interface PointerCancel {
  readonly type: 'pointercancel';
  readonly pointerId: number;
}

export interface WheelEvent {
  readonly type: 'wheel';
  readonly screen: Vec2;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly pageSize: number;
}

export interface Cancel {
  readonly type: 'cancel';
}

export type InteractionEvent =
  PointerDown | PointerMove | PointerUp | PointerCancel | WheelEvent | Cancel;

export interface ConnectPreview {
  readonly sourceId: NodeId;
  readonly sourcePort: PortId;
  readonly pointer: Vec2;
  readonly target: { readonly id: NodeId; readonly port: PortId } | undefined;
}

export interface MovedNode {
  readonly id: NodeId;
  readonly pos: Vec2;
}

export type Effect =
  | { readonly kind: 'select'; readonly selection: Selection }
  | { readonly kind: 'previewMove'; readonly moves: readonly MovedNode[] }
  | { readonly kind: 'clearPreview' }
  | { readonly kind: 'commitMove'; readonly moves: readonly MovedNode[] }
  | { readonly kind: 'viewport'; readonly viewport: Viewport }
  | { readonly kind: 'marquee'; readonly rect: Rect | undefined }
  | { readonly kind: 'connectPreview'; readonly preview: ConnectPreview | undefined }
  | {
      readonly kind: 'connect';
      readonly sourceId: NodeId;
      readonly sourcePort: PortId;
      readonly targetId: NodeId;
      readonly targetPort: PortId;
    }
  | { readonly kind: 'createNode'; readonly nodeType: NodeType; readonly position: Vec2 };

export interface Pointer {
  readonly id: number;
  readonly screen: Vec2;
}

interface Tracked {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly last: Vec2;
}

interface Idle {
  readonly mode: 'idle';
}

export interface PressNode extends Tracked {
  readonly mode: 'pressNode';
  readonly nodeId: NodeId;
  readonly nodes: readonly NodeId[];
  readonly startScreen: Vec2;
  readonly deferred: 'none' | 'toggleOff' | 'collapse';
}

export interface DragNodes extends Tracked {
  readonly mode: 'dragNodes';
  readonly startScreen: Vec2;
  readonly origins: readonly { readonly id: NodeId; readonly rect: Rect }[];
  readonly delta: Vec2;
}

export interface PressCanvas extends Tracked {
  readonly mode: 'pressCanvas';
  readonly startScreen: Vec2;
  readonly additive: boolean;
  readonly base: Selection;
}

export interface Marquee extends Tracked {
  readonly mode: 'marquee';
  readonly startWorld: Vec2;
  readonly additive: boolean;
  readonly base: Selection;
  readonly lastKey: string;
}

export interface Pan extends Tracked {
  readonly mode: 'pan';
}

export interface Connect extends Tracked {
  readonly mode: 'connect';
  readonly sourceId: NodeId;
  readonly sourcePort: PortId;
  readonly target: ConnectPreview['target'];
}

export interface Pinch {
  readonly mode: 'pinch';
  readonly first: Pointer;
  readonly second: Pointer;
  readonly startViewport: Viewport;
  readonly startFirst: Vec2;
  readonly startSecond: Vec2;
}

export type SinglePointerState = PressNode | DragNodes | PressCanvas | Marquee | Pan | Connect;

export type InteractionState = Idle | SinglePointerState | Pinch;

export const IDLE: InteractionState = { mode: 'idle' };

export interface Transition {
  readonly state: InteractionState;
  readonly effects: readonly Effect[];
}
