import type { GraphNode, PortId } from '@coschema/model';

export interface PortPair {
  readonly sourcePort: PortId;
  readonly targetPort: PortId;
}

type Side = 'n' | 'e' | 's' | 'w';
type Placed = Pick<GraphNode, 'pos' | 'size'>;

const OPPOSITE: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };

function center(node: Placed): readonly [number, number] {
  return [node.pos[0] + node.size[0] / 2, node.pos[1] + node.size[1] / 2];
}

function sideFacing(dx: number, dy: number): Side {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

export function portsBetween(source: Placed, target: Placed): PortPair {
  const [sx, sy] = center(source);
  const [tx, ty] = center(target);
  const side = sideFacing(tx - sx, ty - sy);
  return { sourcePort: side, targetPort: OPPOSITE[side] };
}
