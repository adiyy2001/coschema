import { describe, expect, it } from 'vitest';
import { portsBetween } from './connect-ports';

const box = (x: number, y: number) => ({ pos: [x, y] as const, size: [100, 60] as const });

describe('portsBetween', () => {
  it('joins facing sides for a target to the right and to the left', () => {
    expect(portsBetween(box(0, 0), box(300, 0))).toEqual({ sourcePort: 'e', targetPort: 'w' });
    expect(portsBetween(box(300, 0), box(0, 0))).toEqual({ sourcePort: 'w', targetPort: 'e' });
  });

  it('joins facing sides for a target below and above', () => {
    expect(portsBetween(box(0, 0), box(0, 300))).toEqual({ sourcePort: 's', targetPort: 'n' });
    expect(portsBetween(box(0, 300), box(0, 0))).toEqual({ sourcePort: 'n', targetPort: 's' });
  });

  it('uses the larger axis when the target is diagonal', () => {
    expect(portsBetween(box(0, 0), box(400, 100))).toEqual({ sourcePort: 'e', targetPort: 'w' });
    expect(portsBetween(box(0, 0), box(100, 400))).toEqual({ sourcePort: 's', targetPort: 'n' });
  });
});
