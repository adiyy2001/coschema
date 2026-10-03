import { describe, expect, it } from 'vitest';
import {
  MIN_ACCESSIBILITY_SCORE,
  allMeetTarget,
  parseAccessibilityReport,
  toPageResult,
} from '../lighthouse/report';

const REPORT = {
  categories: { accessibility: { score: 0.9649 } },
  audits: {
    'color-contrast': {
      title: 'Background and foreground colors have a sufficient contrast ratio',
      score: 0,
      scoreDisplayMode: 'binary',
      details: { items: [{ node: { snippet: '<button>Save</button>' } }, {}] },
    },
    'image-alt': { title: 'Images have alt text', score: 1, scoreDisplayMode: 'binary' },
    'aria-allowed-attr': {
      title: 'Not applicable',
      score: null,
      scoreDisplayMode: 'notApplicable',
    },
    'link-name': { title: 'Links have a name', score: 0, scoreDisplayMode: 'binary' },
  },
};

describe('parseAccessibilityReport', () => {
  it('rounds the score to a whole number and lists failed binary audits with their item counts', () => {
    expect(parseAccessibilityReport(REPORT)).toEqual({
      score: 96,
      failed: [
        {
          id: 'color-contrast',
          title: 'Background and foreground colors have a sufficient contrast ratio',
          items: 2,
          examples: ['<button>Save</button>'],
        },
        { id: 'link-name', title: 'Links have a name', items: 0, examples: [] },
      ],
    });
  });

  it('rejects a report without a score', () => {
    expect(() => parseAccessibilityReport({ categories: {} })).toThrow('no accessibility score');
    expect(() => parseAccessibilityReport(null)).toThrow('no accessibility score');
  });

  it('copes with a report that has a score and no audits', () => {
    expect(parseAccessibilityReport({ categories: { accessibility: { score: 1 } } })).toEqual({
      score: 100,
      failed: [],
    });
  });
});

describe('page results', () => {
  it('marks a page as meeting the target at the minimum score and not below it', () => {
    const at = toPageResult('/', 'desktop', { score: MIN_ACCESSIBILITY_SCORE, failed: [] });
    const below = toPageResult('/demo', 'mobile', {
      score: MIN_ACCESSIBILITY_SCORE - 1,
      failed: [],
    });
    expect(at.meetsTarget).toBe(true);
    expect(below.meetsTarget).toBe(false);
    expect(allMeetTarget([at])).toBe(true);
    expect(allMeetTarget([at, below])).toBe(false);
    expect(allMeetTarget([])).toBe(false);
  });
});
