import type { NodeId } from './ids';

export interface PresenceUser {
  readonly name: string;
  readonly color: string;
}

export interface PresenceCursor {
  readonly x: number;
  readonly y: number;
}

export interface PresenceViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PresenceState {
  readonly user: PresenceUser;
  readonly cursor: PresenceCursor | null;
  readonly selection: readonly NodeId[];
  readonly viewport: PresenceViewport | null;
  readonly following: number | null;
}

export const PRESENCE_COLORS: readonly string[] = [
  '#d6336c',
  '#1c7ed6',
  '#2f9e44',
  '#e8590c',
  '#7048e8',
  '#0c8599',
  '#c2255c',
  '#5c940d',
];

export const MAX_NAME_LENGTH = 40;
export const MAX_SELECTION_SIZE = 500;
export const MAX_ID_LENGTH = 64;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const COORDINATE_LIMIT = 1e9;

export function createPresence(user: PresenceUser): PresenceState {
  return { user, cursor: null, selection: [], viewport: null, following: null };
}

export function colorForIndex(index: number): string {
  const size = PRESENCE_COLORS.length;
  const color = PRESENCE_COLORS[((index % size) + size) % size];
  return color ?? '#1c7ed6';
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseUser(value: unknown): PresenceUser | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const { name, color } = record;
  if (typeof name !== 'string' || typeof color !== 'string') return undefined;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (trimmed.length === 0 || !COLOR_PATTERN.test(color)) return undefined;
  return { name: trimmed, color: color.toLowerCase() };
}

function parseCursor(value: unknown): PresenceCursor | null {
  const record = asRecord(value);
  if (record === undefined || !isCoordinate(record['x']) || !isCoordinate(record['y'])) return null;
  return { x: record['x'], y: record['y'] };
}

function parseViewport(value: unknown): PresenceViewport | null {
  const record = asRecord(value);
  if (record === undefined) return null;
  const { x, y, width, height } = record;
  if (!isCoordinate(x) || !isCoordinate(y) || !isCoordinate(width) || !isCoordinate(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function parseSelection(value: unknown): NodeId[] {
  if (!Array.isArray(value)) return [];
  const ids: NodeId[] = [];
  for (const entry of value as unknown[]) {
    if (ids.length >= MAX_SELECTION_SIZE) break;
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_ID_LENGTH) {
      ids.push(entry);
    }
  }
  return ids;
}

export function parsePresence(value: unknown): PresenceState | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const user = parseUser(record['user']);
  if (user === undefined) return undefined;
  const following = record['following'];
  return {
    user,
    cursor: parseCursor(record['cursor']),
    selection: parseSelection(record['selection']),
    viewport: parseViewport(record['viewport']),
    following: typeof following === 'number' && Number.isInteger(following) ? following : null,
  };
}
