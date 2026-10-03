import { rectsIntersect, type Rect } from '@coschema/geometry';
import type { PresenceViewport } from '@coschema/model';

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

export function shouldShowIndicator(peer: PresenceViewport, own: Rect): boolean {
  return rectsIntersect(peer, own) && !containsRect(peer, own);
}
