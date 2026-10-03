const AVERAGE_GLYPH_WIDTH = 0.58;
const ELLIPSIS = '…';

export function fitLabel(label: string, availableWidth: number, fontSize: number): string {
  const capacity = Math.floor(availableWidth / (fontSize * AVERAGE_GLYPH_WIDTH));
  if (capacity <= 0) return '';
  if (label.length <= capacity) return label;
  if (capacity === 1) return ELLIPSIS;
  return `${label.slice(0, capacity - 1)}${ELLIPSIS}`;
}
