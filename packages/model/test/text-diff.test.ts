import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffText } from '../src';

function apply(
  before: string,
  edit: { index: number; deleteCount: number; insert: string },
): string {
  return before.slice(0, edit.index) + edit.insert + before.slice(edit.index + edit.deleteCount);
}

describe('diffText', () => {
  it('returns nothing for equal strings', () => {
    expect(diffText('same', 'same')).toBeUndefined();
  });

  it('finds an insertion in the middle', () => {
    expect(diffText('Pump 3', 'Pump A 3')).toEqual({ index: 5, deleteCount: 0, insert: 'A ' });
  });

  it('finds a deletion', () => {
    expect(diffText('Pump 3', 'Pump')).toEqual({ index: 4, deleteCount: 2, insert: '' });
  });

  it('finds a replacement that touches only the changed characters', () => {
    expect(diffText('Pump 3', 'Pump 4')).toEqual({ index: 5, deleteCount: 1, insert: '4' });
  });

  it('handles empty strings', () => {
    expect(diffText('', 'abc')).toEqual({ index: 0, deleteCount: 0, insert: 'abc' });
    expect(diffText('abc', '')).toEqual({ index: 0, deleteCount: 3, insert: '' });
  });

  it('does not let prefix and suffix overlap on repeated characters', () => {
    expect(apply('aa', diffText('aa', 'aaa') ?? { index: 0, deleteCount: 0, insert: '' })).toBe(
      'aaa',
    );
    expect(apply('aaa', diffText('aaa', 'aa') ?? { index: 0, deleteCount: 0, insert: '' })).toBe(
      'aa',
    );
  });

  it('never splits a surrogate pair', () => {
    const edit = diffText('a\u{1F600}b', 'a\u{1F601}b');
    expect(edit).toEqual({ index: 1, deleteCount: 2, insert: '\u{1F601}' });
    const other = diffText('\u{1F600}', '\u{1F601}\u{1F600}');
    expect(other).toBeDefined();
    expect(apply('\u{1F600}', other ?? { index: 0, deleteCount: 0, insert: '' })).toBe(
      '\u{1F601}\u{1F600}',
    );
  });

  it('turns any string into any other string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (before, after) => {
        const edit = diffText(before, after);
        expect(edit === undefined ? before : apply(before, edit)).toBe(after);
      }),
      { numRuns: 1000 },
    );
  });

  it('keeps the edit minimal on common prefix and suffix', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-ascii' }),
        fc.string({ unit: 'grapheme-ascii' }),
        fc.string({ unit: 'grapheme-ascii' }),
        (prefix, suffix, middle) => {
          const edit = diffText(prefix + suffix, prefix + middle + suffix);
          if (edit === undefined) return;
          expect(edit.deleteCount).toBe(0);
          expect(edit.insert.length).toBeLessThanOrEqual(middle.length);
        },
      ),
    );
  });
});
