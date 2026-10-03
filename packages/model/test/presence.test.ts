import { describe, expect, it } from 'vitest';
import {
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SELECTION_SIZE,
  PRESENCE_COLORS,
  colorForIndex,
  createPresence,
  parsePresence,
} from '../src';

const user = { name: 'Anna', color: '#1c7ed6' };

describe('createPresence', () => {
  it('starts with no cursor, selection, viewport or follow target', () => {
    expect(createPresence(user)).toEqual({
      user,
      cursor: null,
      selection: [],
      viewport: null,
      following: null,
    });
  });
});

describe('colorForIndex', () => {
  it('cycles through the palette, also for negative indexes', () => {
    expect(colorForIndex(0)).toBe(PRESENCE_COLORS[0]);
    expect(colorForIndex(PRESENCE_COLORS.length)).toBe(PRESENCE_COLORS[0]);
    expect(colorForIndex(-1)).toBe(PRESENCE_COLORS[PRESENCE_COLORS.length - 1]);
  });

  it('uses distinct colours for the first eight people', () => {
    expect(new Set(PRESENCE_COLORS).size).toBe(PRESENCE_COLORS.length);
  });
});

describe('parsePresence', () => {
  it('round trips a full state', () => {
    const state = {
      user,
      cursor: { x: 10.5, y: -4 },
      selection: ['a', 'b'],
      viewport: { x: 0, y: 0, width: 1200, height: 800 },
      following: 42,
    };
    expect(parsePresence(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('rejects anything that is not an object with a valid user', () => {
    for (const value of [
      null,
      undefined,
      4,
      'x',
      [],
      {},
      { user: null },
      { user: { name: 'A' } },
    ]) {
      expect(parsePresence(value)).toBeUndefined();
    }
    expect(parsePresence({ user: { name: '   ', color: '#112233' } })).toBeUndefined();
    expect(parsePresence({ user: { name: 'A', color: 'red' } })).toBeUndefined();
    expect(parsePresence({ user: { name: 4, color: '#112233' } })).toBeUndefined();
  });

  it('trims and caps names and lowercases colours', () => {
    const parsed = parsePresence({ user: { name: `  ${'x'.repeat(100)}  `, color: '#ABCDEF' } });
    expect(parsed?.user.name).toHaveLength(MAX_NAME_LENGTH);
    expect(parsed?.user.color).toBe('#abcdef');
  });

  it('drops a cursor with missing, non finite or absurd coordinates', () => {
    const base = { user };
    expect(parsePresence({ ...base, cursor: { x: 1 } })?.cursor).toBeNull();
    expect(parsePresence({ ...base, cursor: { x: Number.NaN, y: 1 } })?.cursor).toBeNull();
    expect(parsePresence({ ...base, cursor: { x: 1e12, y: 1 } })?.cursor).toBeNull();
    expect(parsePresence({ ...base, cursor: 'here' })?.cursor).toBeNull();
    expect(parsePresence({ ...base, cursor: { x: 1, y: 2 } })?.cursor).toEqual({ x: 1, y: 2 });
  });

  it('drops viewports that are incomplete or have no area', () => {
    const base = { user };
    expect(
      parsePresence({ ...base, viewport: { x: 0, y: 0, width: 0, height: 5 } })?.viewport,
    ).toBeNull();
    expect(parsePresence({ ...base, viewport: { x: 0, y: 0, width: 5 } })?.viewport).toBeNull();
    expect(parsePresence({ ...base, viewport: 7 })?.viewport).toBeNull();
    expect(
      parsePresence({ ...base, viewport: { x: 1, y: 2, width: 3, height: 4 } })?.viewport,
    ).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('keeps only sensible ids in the selection and caps its size', () => {
    const selection = [
      'ok',
      '',
      4,
      null,
      'x'.repeat(MAX_ID_LENGTH + 1),
      ...Array.from({ length: MAX_SELECTION_SIZE + 50 }, (_, index) => `n${index}`),
    ];
    const parsed = parsePresence({ user, selection });
    expect(parsed?.selection).toHaveLength(MAX_SELECTION_SIZE);
    expect(parsed?.selection[0]).toBe('ok');
    expect(parsePresence({ user, selection: 'all' })?.selection).toEqual([]);
  });

  it('accepts only integer follow targets', () => {
    expect(parsePresence({ user, following: 7 })?.following).toBe(7);
    expect(parsePresence({ user, following: 7.5 })?.following).toBeNull();
    expect(parsePresence({ user, following: '7' })?.following).toBeNull();
  });
});
