import { describe, expect, it } from 'vitest';
import { CLOSE_ABNORMAL, createWebSocketTransport } from '../src';

type Listener = (event: unknown) => void;

class FakeWebSocket {
  binaryType = 'blob';
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  readonly closeCalls: unknown[][] = [];
  rejectCloseCode = false;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(...args: unknown[]): void {
    this.closeCalls.push(args);
    if (this.rejectCloseCode && args.length > 0) throw new Error('invalid close code');
  }

  fire(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function setup(): {
  socket: FakeWebSocket;
  transport: ReturnType<typeof createWebSocketTransport>;
} {
  const socket = new FakeWebSocket();
  const transport = createWebSocketTransport('ws://example.test/rooms/a', (url) => {
    expect(url).toBe('ws://example.test/rooms/a');
    return socket as unknown as WebSocket;
  });
  return { socket, transport };
}

describe('createWebSocketTransport', () => {
  it('asks for binary frames as array buffers', () => {
    const { socket } = setup();
    expect(socket.binaryType).toBe('arraybuffer');
  });

  it('reports the open event', () => {
    const { socket, transport } = setup();
    let opened = 0;
    const unsubscribe = transport.onOpen(() => {
      opened += 1;
    });
    socket.fire('open');
    unsubscribe();
    socket.fire('open');
    expect(opened).toBe(1);
  });

  it('delivers binary messages as byte arrays and ignores text', () => {
    const { socket, transport } = setup();
    const received: Uint8Array[] = [];
    transport.onMessage((data) => received.push(data));
    socket.fire('message', { data: new Uint8Array([1, 2, 3]).buffer });
    socket.fire('message', { data: 'text' });
    expect(received).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it('reports close codes and falls back to 1006 when the code is zero', () => {
    const { socket, transport } = setup();
    const closes: [number, string][] = [];
    transport.onClose((code, reason) => closes.push([code, reason]));
    socket.fire('close', { code: 4401, reason: 'denied' });
    socket.fire('close', { code: 0, reason: '' });
    expect(closes).toEqual([
      [4401, 'denied'],
      [CLOSE_ABNORMAL, ''],
    ]);
  });

  it('sends only while the socket is open', () => {
    const { socket, transport } = setup();
    transport.send(new Uint8Array([1]));
    socket.readyState = 1;
    transport.send(new Uint8Array([2]));
    expect(socket.sent).toEqual([new Uint8Array([2])]);
  });

  it('closes with a code and falls back to a plain close when the code is refused', () => {
    const { socket, transport } = setup();
    transport.close(4401, 'denied');
    socket.rejectCloseCode = true;
    transport.close(1001, 'going away');
    expect(socket.closeCalls).toEqual([[4401, 'denied'], [1001, 'going away'], []]);
  });

  it('uses the global WebSocket constructor by default', () => {
    const original = globalThis.WebSocket;
    const created: string[] = [];
    class Recorded extends FakeWebSocket {
      constructor(url: string) {
        super();
        created.push(url);
      }
    }
    globalThis.WebSocket = Recorded as unknown as typeof WebSocket;
    try {
      createWebSocketTransport('ws://example.test/default');
    } finally {
      globalThis.WebSocket = original;
    }
    expect(created).toEqual(['ws://example.test/default']);
  });
});
