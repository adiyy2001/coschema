import { describe, expect, it } from 'vitest';
import { freePosition } from './free-position';

const SIZE: [number, number] = [120, 60];

describe('freePosition', () => {
  it('keeps the preferred spot when nothing is there', () => {
    expect(freePosition([48, 48], SIZE, [], 24)).toEqual([48, 48]);
  });

  it('keeps the preferred spot when the neighbours only touch it', () => {
    const touching = { x: 168, y: 48, width: 120, height: 60 };
    expect(freePosition([48, 48], SIZE, [touching], 24)).toEqual([48, 48]);
  });

  it('moves to a free cell next to an occupied one', () => {
    const occupied = [{ x: 48, y: 48, width: 120, height: 60 }];
    const [x, y] = freePosition([48, 48], SIZE, occupied, 24);
    expect(x === 48 && y === 48).toBe(false);
    expect(Math.abs(x - 48) <= 144 && Math.abs(y - 48) <= 96).toBe(true);
    expect(x % 24 === 0).toBe(true);
    expect(y % 24 === 0).toBe(true);
  });

  it('puts a third node on a spot that is free of both earlier ones', () => {
    const occupied = [{ x: 48, y: 48, width: 120, height: 60 }];
    const second = freePosition([48, 48], SIZE, occupied, 24);
    occupied.push({ x: second[0], y: second[1], width: 120, height: 60 });
    const third = freePosition([48, 48], SIZE, occupied, 24);
    for (const other of occupied) {
      const overlaps =
        third[0] < other.x + other.width &&
        other.x < third[0] + 120 &&
        third[1] < other.y + other.height &&
        other.y < third[1] + 60;
      expect(overlaps).toBe(false);
    }
  });

  it('is deterministic', () => {
    const occupied = [{ x: 0, y: 0, width: 300, height: 300 }];
    expect(freePosition([48, 48], SIZE, occupied, 24)).toEqual(
      freePosition([48, 48], SIZE, occupied, 24),
    );
  });

  it('falls back to the preferred spot when the whole search area is full', () => {
    const everything = [{ x: -100_000, y: -100_000, width: 200_000, height: 200_000 }];
    expect(freePosition([48, 48], SIZE, everything, 24)).toEqual([48, 48]);
  });
});
