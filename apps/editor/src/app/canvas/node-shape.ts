import type { GraphNode, NodeType, Size } from '@coschema/model';
import { fitLabel } from './fit-label';

export const DEFAULT_FONT_SIZE = 14;
export const ROUNDED_RADIUS = 10;
const LABEL_PADDING = 10;
const LABEL_WIDTH_FACTORS: Readonly<Record<NodeType, number>> = {
  rect: 1,
  rounded: 1,
  ellipse: 0.8,
  diamond: 0.62,
};

export function fontSizeOf(node: Pick<GraphNode, 'style'>): number {
  return node.style.fontSize ?? DEFAULT_FONT_SIZE;
}

export function fittedLabel(node: Pick<GraphNode, 'type' | 'size' | 'style' | 'label'>): string {
  const usable = node.size[0] * LABEL_WIDTH_FACTORS[node.type] - LABEL_PADDING * 2;
  return fitLabel(node.label, usable, fontSizeOf(node));
}

export function diamondPoints(size: Size): string {
  const [width, height] = size;
  return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
}
