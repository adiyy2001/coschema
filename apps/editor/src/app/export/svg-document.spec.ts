import type { GraphNode } from '@coschema/model';
import { describe, expect, it } from 'vitest';
import type { ExportEdge, ExportScene } from '../core/graph-view';
import { EXPORT_MARGIN, buildSvgDocument, escapeXml, sceneBounds } from './svg-document';

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'rect',
    pos: [0, 0],
    size: [120, 64],
    z: 'a0',
    style: {},
    label: id,
    ...overrides,
  };
}

function edge(id: string, points: ExportEdge['points'], fallback = false): ExportEdge {
  return { id, points, fallback };
}

function parse(markup: string): Document {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(parsed.querySelector('parsererror')).toBeNull();
  return parsed;
}

const SCENE: ExportScene = {
  nodes: [
    node('a', { pos: [10, 20], label: 'Pump A' }),
    node('b', { pos: [300, 20], type: 'ellipse', label: 'Tank' }),
    node('c', { pos: [300, 200], type: 'diamond', size: [112, 84], label: 'Check' }),
    node('d', { pos: [10, 200], type: 'rounded', label: 'Valve' }),
  ],
  edges: [
    edge('e1', [
      [130, 52],
      [300, 52],
    ]),
    edge(
      'e2',
      [
        [356, 104],
        [356, 200],
      ],
      true,
    ),
  ],
};

describe('buildSvgDocument', () => {
  it('returns nothing for an empty diagram', () => {
    expect(buildSvgDocument({ nodes: [], edges: [] })).toBeUndefined();
  });

  it('produces well formed SVG with one element per node and per edge', () => {
    const document = buildSvgDocument(SCENE);
    expect(document).toBeDefined();
    const parsed = parse(document?.markup ?? '');
    expect(parsed.documentElement.localName).toBe('svg');
    expect(parsed.querySelectorAll('[data-node-id]')).toHaveLength(4);
    expect(parsed.querySelectorAll('[data-edge-id]')).toHaveLength(2);
    expect(parsed.querySelectorAll('ellipse')).toHaveLength(1);
    expect(parsed.querySelectorAll('polygon')).toHaveLength(1);
    expect(parsed.querySelectorAll('rect[rx="10"]')).toHaveLength(1);
  });

  it('frames the content with a margin and sets the size and view box', () => {
    const document = buildSvgDocument(SCENE);
    const bounds = sceneBounds(SCENE);
    expect(bounds).toEqual({ x: 10, y: 20, width: 410, height: 264 });
    expect(document?.width).toBe(410 + EXPORT_MARGIN * 2);
    expect(document?.height).toBe(264 + EXPORT_MARGIN * 2);
    const parsed = parse(document?.markup ?? '');
    expect(parsed.documentElement.getAttribute('viewBox')).toBe(
      `${10 - EXPORT_MARGIN} ${20 - EXPORT_MARGIN} ${document?.width} ${document?.height}`,
    );
  });

  it('includes edges that leave the area of the nodes in the bounds', () => {
    const wide: ExportScene = {
      nodes: [node('a')],
      edges: [
        edge('e', [
          [0, 0],
          [-300, 0],
          [-300, 500],
        ]),
      ],
    };
    expect(sceneBounds(wide)).toEqual({ x: -300, y: 0, width: 420, height: 500 });
  });

  it('draws fallback routes dashed and keeps the others solid', () => {
    const parsed = parse(buildSvgDocument(SCENE)?.markup ?? '');
    expect(parsed.querySelector('[data-edge-id="e2"]')?.getAttribute('stroke-dasharray')).toBe(
      '6 4',
    );
    expect(parsed.querySelector('[data-edge-id="e1"]')?.hasAttribute('stroke-dasharray')).toBe(
      false,
    );
  });

  it('positions nodes with their world coordinates and writes the fitted label', () => {
    const parsed = parse(buildSvgDocument(SCENE)?.markup ?? '');
    const first = parsed.querySelector('[data-node-id="a"]');
    expect(first?.getAttribute('transform')).toBe('translate(10 20)');
    expect(first?.querySelector('text')?.textContent).toBe('Pump A');
  });

  it('shortens labels that do not fit like the editor does', () => {
    const long = node('x', { label: 'A very long label that cannot fit into the box' });
    const parsed = parse(buildSvgDocument({ nodes: [long], edges: [] })?.markup ?? '');
    const text = parsed.querySelector('text')?.textContent ?? '';
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(long.label.length);
  });

  it('leaves out the label element for an empty label', () => {
    const parsed = parse(
      buildSvgDocument({ nodes: [node('x', { label: '' })], edges: [] })?.markup ?? '',
    );
    expect(parsed.querySelector('text')).toBeNull();
  });

  it('applies the style overrides of a node', () => {
    const styled = node('s', {
      style: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, fontSize: 20 },
    });
    const parsed = parse(buildSvgDocument({ nodes: [styled], edges: [] })?.markup ?? '');
    const shape = parsed.querySelector('[data-node-id="s"] rect');
    expect(shape?.getAttribute('fill')).toBe('#ff0000');
    expect(shape?.getAttribute('stroke')).toBe('#00ff00');
    expect(shape?.getAttribute('stroke-width')).toBe('4');
    expect(parsed.querySelector('text')?.getAttribute('font-size')).toBe('20');
  });

  it('keeps hostile text and attributes from breaking out of the markup', () => {
    const hostile = node('"><script>alert(1)</script>', {
      label: '<img src=x onerror=alert(1)> & "quotes"',
      style: { fill: '" onload="alert(1)' },
    });
    const document = buildSvgDocument({ nodes: [hostile], edges: [] });
    const parsed = parse(document?.markup ?? '');
    expect(parsed.querySelector('script')).toBeNull();
    expect(parsed.querySelector('img')).toBeNull();
    expect(parsed.querySelector('[onload]')).toBeNull();
    expect(parsed.querySelector('text')?.textContent).toContain('<img');
    expect(parsed.querySelector('g[data-node-id] rect')?.getAttribute('fill')).toBe(
      '" onload="alert(1)',
    );
  });

  it('describes the diagram for assistive technology', () => {
    const parsed = parse(buildSvgDocument(SCENE)?.markup ?? '');
    expect(parsed.documentElement.getAttribute('aria-label')).toBe(
      'Diagram with 4 nodes and 2 connections',
    );
    expect(parsed.querySelector('title')?.textContent).toBe(
      'Diagram with 4 nodes and 2 connections',
    );
    const single = parse(
      buildSvgDocument({
        nodes: [node('a')],
        edges: [
          edge('e', [
            [0, 0],
            [1, 1],
          ]),
        ],
      })?.markup ?? '',
    );
    expect(single.documentElement.getAttribute('aria-label')).toBe(
      'Diagram with 1 node and 1 connection',
    );
  });
});

describe('escapeXml', () => {
  it('escapes the five special characters and drops control characters', () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
    expect(escapeXml('a\u0000b\u0008c\u001Fd\uFFFE')).toBe('abcd');
    expect(escapeXml('a\uD800b')).toBe('ab');
    expect(escapeXml('smile \u{1F600}')).toBe('smile \u{1F600}');
    expect(escapeXml('tab\tand\nnewline')).toBe('tab\tand\nnewline');
  });
});
