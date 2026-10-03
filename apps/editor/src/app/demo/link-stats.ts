import type { LinkStats } from '@coschema/sim/link';

export function inFlight(stats: LinkStats): number {
  const outstanding =
    stats.sent +
    stats.duplicated -
    stats.delivered -
    stats.droppedByLoss -
    stats.droppedByPartition -
    stats.droppedByOffline -
    stats.droppedBecauseClosed;
  return Math.max(0, outstanding);
}

export function dropped(stats: LinkStats): number {
  return (
    stats.droppedByLoss +
    stats.droppedByPartition +
    stats.droppedByOffline +
    stats.droppedBecauseClosed
  );
}
