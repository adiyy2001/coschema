export type DetailLevel = 'full' | 'simple' | 'minimal';

export const FULL_DETAIL_ZOOM = 0.7;
export const SIMPLE_DETAIL_ZOOM = 0.25;

export function detailForZoom(zoom: number): DetailLevel {
  if (zoom >= FULL_DETAIL_ZOOM) return 'full';
  if (zoom >= SIMPLE_DETAIL_ZOOM) return 'simple';
  return 'minimal';
}
