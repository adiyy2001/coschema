export const NODE_TYPES = ['rect', 'rounded', 'ellipse', 'diamond'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const CARDINAL_PORTS = ['n', 'e', 's', 'w'] as const;
export const CORNER_PORTS = ['ne', 'se', 'sw', 'nw'] as const;
export type PortId = (typeof CARDINAL_PORTS)[number] | (typeof CORNER_PORTS)[number];

export type Size = readonly [number, number];
export type Vec2 = readonly [number, number];

export const MIN_NODE_SIZE = 16;
export const MAX_NODE_SIZE = 4096;

export const DEFAULT_NODE_SIZES: Readonly<Record<NodeType, Size>> = {
  rect: [120, 64],
  rounded: [120, 64],
  ellipse: [120, 72],
  diamond: [112, 84],
};

const PORTS_BY_TYPE: Readonly<Record<NodeType, readonly PortId[]>> = {
  rect: [...CARDINAL_PORTS, ...CORNER_PORTS],
  rounded: [...CARDINAL_PORTS, ...CORNER_PORTS],
  ellipse: CARDINAL_PORTS,
  diamond: CARDINAL_PORTS,
};

const PORT_OFFSETS: Readonly<Record<PortId, Vec2>> = {
  n: [0.5, 0],
  e: [1, 0.5],
  s: [0.5, 1],
  w: [0, 0.5],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
  nw: [0, 0],
};

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

export function portsOf(type: NodeType): readonly PortId[] {
  return PORTS_BY_TYPE[type];
}

export function hasPort(type: NodeType, port: unknown): port is PortId {
  return typeof port === 'string' && (PORTS_BY_TYPE[type] as readonly string[]).includes(port);
}

export function portAnchor(position: Vec2, size: Size, port: PortId): Vec2 {
  const [offsetX, offsetY] = PORT_OFFSETS[port];
  return [position[0] + size[0] * offsetX, position[1] + size[1] * offsetY];
}

export function clampSize(size: Size): Size {
  const clamp = (value: number): number => Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, value));
  return [clamp(size[0]), clamp(size[1])];
}
