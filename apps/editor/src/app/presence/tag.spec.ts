import { describe, expect, it } from 'vitest';
import { PRESENCE_COLORS } from '@coschema/model';
import { contrastRatio, readableTextColor, tagLabel, tagWidthPixels } from './tag';

describe('name tags', () => {
  it('grows with the name up to a cap', () => {
    expect(tagWidthPixels('Al')).toBeLessThan(tagWidthPixels('Alexandra'));
    expect(tagWidthPixels('x'.repeat(24))).toBe(tagWidthPixels('x'.repeat(80)));
  });

  it('shortens long names with an ellipsis', () => {
    expect(tagLabel('Anna')).toBe('Anna');
    const shortened = tagLabel('x'.repeat(40));
    expect(shortened).toHaveLength(24);
    expect(shortened.endsWith('…')).toBe(true);
  });

  it('picks text that reaches 4.5 to 1 on every presence colour', () => {
    for (const color of PRESENCE_COLORS) {
      expect(contrastRatio(color, readableTextColor(color))).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(readableTextColor('#000000')).toBe('#ffffff');
  });
});
