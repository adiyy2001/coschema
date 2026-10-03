import { Emitter } from './emitter';
import { CLOSE_NORMAL, type Transport, type Unsubscribe } from './transport';

class MemoryEndpoint implements Transport {
  peer: MemoryEndpoint | undefined;
  closed = false;
  private readonly openEvents = new Emitter<[]>();
  private readonly messageEvents = new Emitter<[Uint8Array]>();
  private readonly closeEvents = new Emitter<[number, string]>();

  constructor(private readonly schedule: (task: () => void) => void) {}

  send(data: Uint8Array): void {
    if (this.closed) return;
    const copy = data.slice();
    const peer = this.peer;
    this.schedule(() => {
      if (peer !== undefined && !peer.closed) peer.messageEvents.emit(copy);
    });
  }

  close(code = CLOSE_NORMAL, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    this.schedule(() => {
      this.closeEvents.emit(code, reason);
    });
    this.schedule(() => {
      if (peer !== undefined && !peer.closed) {
        peer.closed = true;
        peer.closeEvents.emit(code, reason);
      }
    });
  }

  onOpen(handler: () => void): Unsubscribe {
    return this.openEvents.subscribe(handler);
  }

  onMessage(handler: (data: Uint8Array) => void): Unsubscribe {
    return this.messageEvents.subscribe(handler);
  }

  onClose(handler: (code: number, reason: string) => void): Unsubscribe {
    return this.closeEvents.subscribe(handler);
  }

  announceOpen(): void {
    this.schedule(() => {
      this.openEvents.emit();
    });
  }
}

export interface MemoryPair {
  readonly client: Transport;
  readonly server: Transport;
  flush(): void;
  readonly queued: number;
}

export function createMemoryPair(): MemoryPair {
  const queue: (() => void)[] = [];
  const schedule = (task: () => void): void => {
    queue.push(task);
  };
  const client = new MemoryEndpoint(schedule);
  const server = new MemoryEndpoint(schedule);
  client.peer = server;
  server.peer = client;
  client.announceOpen();
  return {
    client,
    server,
    flush: () => {
      for (let task = queue.shift(); task !== undefined; task = queue.shift()) task();
    },
    get queued() {
      return queue.length;
    },
  };
}
