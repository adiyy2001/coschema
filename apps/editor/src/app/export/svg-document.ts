import { type Rect, type Vec2, unionRects } from '@coschema/geometry';
import type { GraphNode } from '@coschema/model';
import type { ExportEdge, ExportScene } from '../core/graph-view';
import { nodeRect } from '../core/shapes';
import {
  DEFAULT_FONT_SIZE,
  ROUNDED_RADIUS,
  diamondPoints,
  fittedLabel,
} from '../canvas/node-shape';
import { routePath } from '../canvas/route-path';

export const EXPORT_MARGIN = 24;
export const EXPORT_THEME = {
  background: '#ffffff',
  nodeFill: '#ffffff',
  nodeStroke: '#3b4252',
  nodeText: '#1b1f2a',
  edge: '#5b6578',
  strokeWidth: 1.5,
} as const;

const ARROW_ID = 'cs-export-arrow';
const FALLBACK_DASH = '6 4';

export interface SvgDocument {
  readonly markup: string;
  readonly width: number;
  readonly height: number;
}

function isXmlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

export function escapeXml(text: string): string {
  return Array.from(text)
    .filter(isXmlCharacter)
    .join('')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pointsBounds(points: readonly Vec2[]): Rect | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function sceneBounds(scene: ExportScene): Rect | undefined {
  let bounds: Rect | undefined;
  const include = (rect: Rect | undefined): void => {
    if (rect === undefined) return;
    bounds = bounds === undefined ? rect : unionRects(bounds, rect);
  };
  for (const node of scene.nodes) include(nodeRect(node));
  for (const edge of scene.edges) include(pointsBounds(edge.points));
  return bounds;
}

function styleAttributes(node: GraphNode): string {
  const fill = node.style.fill ?? EXPORT_THEME.nodeFill;
  const stroke = node.style.stroke ?? EXPORT_THEME.nodeStroke;
  const width = node.style.strokeWidth ?? EXPORT_THEME.strokeWidth;
  return `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${number(width)}"`;
}

function shapeMarkup(node: GraphNode): string {
  const [width, height] = node.size;
  const style = styleAttributes(node);
  if (node.type === 'ellipse') {
    return `<ellipse cx="${number(width / 2)}" cy="${number(height / 2)}" rx="${number(width / 2)}" ry="${number(height / 2)}" ${style}/>`;
  }
  if (node.type === 'diamond') {
    return `<polygon points="${diamondPoints(node.size)}" ${style}/>`;
  }
  const radius = node.type === 'rounded' ? ROUNDED_RADIUS : 0;
  return `<rect width="${number(width)}" height="${number(height)}" rx="${radius}" ${style}/>`;
}

function labelMarkup(node: GraphNode): string {
  const text = fittedLabel(node);
  if (text === '') return '';
  const fontSize = node.style.fontSize ?? DEFAULT_FONT_SIZE;
  return `<text x="${number(node.size[0] / 2)}" y="${number(node.size[1] / 2)}" text-anchor="middle" dominant-baseline="central" font-size="${number(fontSize)}" fill="${EXPORT_THEME.nodeText}" stroke="none">${escapeXml(text)}</text>`;
}

function nodeMarkup(node: GraphNode): string {
  const transform = `translate(${number(node.pos[0])} ${number(node.pos[1])})`;
  return `<g data-node-id="${escapeXml(node.id)}" transform="${transform}">${shapeMarkup(node)}${labelMarkup(node)}</g>`;
}

function edgeMarkup(edge: ExportEdge): string {
  const dash = edge.fallback ? ` stroke-dasharray="${FALLBACK_DASH}"` : '';
  return `<path data-edge-id="${escapeXml(edge.id)}" d="${routePath(edge.points)}" marker-end="url(#${ARROW_ID})"${dash}/>`;
}

function describe(scene: ExportScene): string {
  const nodes = scene.nodes.length === 1 ? '1 node' : `${scene.nodes.length} nodes`;
  const edges = scene.edges.length === 1 ? '1 connection' : `${scene.edges.length} connections`;
  return `Diagram with ${nodes} and ${edges}`;
}

export function buildSvgDocument(scene: ExportScene): SvgDocument | undefined {
  const bounds = sceneBounds(scene);
  if (bounds === undefined) return undefined;
  const x = Math.floor(bounds.x - EXPORT_MARGIN);
  const y = Math.floor(bounds.y - EXPORT_MARGIN);
  const width = Math.ceil(bounds.x + bounds.width + EXPORT_MARGIN) - x;
  const height = Math.ceil(bounds.y + bounds.height + EXPORT_MARGIN) - y;
  const title = describe(scene);
  const markup = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family="system-ui, sans-serif" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<defs><marker id="${ARROW_ID}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 Z" fill="${EXPORT_THEME.edge}"/></marker></defs>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${EXPORT_THEME.background}"/>`,
    `<g fill="none" stroke="${EXPORT_THEME.edge}" stroke-width="${EXPORT_THEME.strokeWidth}" stroke-linejoin="round">${scene.edges.map(edgeMarkup).join('')}</g>`,
    scene.nodes.map(nodeMarkup).join(''),
    '</svg>',
  ].join('\n');
  return { markup, width, height };
}
