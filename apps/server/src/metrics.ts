export type CounterName =
  | 'updates_applied_total'
  | 'batches_flushed_total'
  | 'bytes_persisted_total'
  | 'compactions_total'
  | 'auth_failures_total'
  | 'persistence_errors_total'
  | 'connections_total'
  | 'rooms_loaded_total'
  | 'rooms_unloaded_total';

const COUNTER_HELP: Readonly<Record<CounterName, string>> = {
  updates_applied_total: 'Document updates applied across all rooms',
  batches_flushed_total: 'Batched writes appended to the update log',
  bytes_persisted_total: 'Bytes appended to the update log',
  compactions_total: 'Update log compactions into a snapshot',
  auth_failures_total: 'Connections closed with 4401',
  persistence_errors_total: 'Failed appends to the update log',
  connections_total: 'WebSocket connections accepted',
  rooms_loaded_total: 'Rooms loaded into memory',
  rooms_unloaded_total: 'Rooms unloaded after going idle',
};

export type GaugeName = 'rooms' | 'connections';

const GAUGE_HELP: Readonly<Record<GaugeName, string>> = {
  rooms: 'Rooms currently in memory',
  connections: 'Open WebSocket connections',
};

export class Metrics {
  private readonly counters = new Map<CounterName, number>();
  private readonly gauges = new Map<GaugeName, () => number>();

  increment(name: CounterName, amount = 1): void {
    this.counters.set(name, this.count(name) + amount);
  }

  count(name: CounterName): number {
    return this.counters.get(name) ?? 0;
  }

  setGauge(name: GaugeName, read: () => number): void {
    this.gauges.set(name, read);
  }

  gauge(name: GaugeName): number {
    return this.gauges.get(name)?.() ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const name of Object.keys(COUNTER_HELP) as CounterName[]) {
      lines.push(`# HELP coschema_${name} ${COUNTER_HELP[name]}`);
      lines.push(`# TYPE coschema_${name} counter`);
      lines.push(`coschema_${name} ${this.count(name)}`);
    }
    for (const name of Object.keys(GAUGE_HELP) as GaugeName[]) {
      lines.push(`# HELP coschema_${name} ${GAUGE_HELP[name]}`);
      lines.push(`# TYPE coschema_${name} gauge`);
      lines.push(`coschema_${name} ${this.gauge(name)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
