import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { WsTransport } from '../src/ws-transport';
import { settle } from './support/manual-clock';

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Uint8Array[] = [];
  readonly closes: [number | undefined, string | undefined][] = [];
  terminated = false;
  pings = 0;

  send(data: Uint8Array, _options: unknown, callback: () => void): void {
    this.sent.push(data);
    callback();
  }

  close(code?: number, reason?: string): void {
    this.closes.push([code, reason]);
  }

  terminate(): void {
    this.terminated = true;
  }

  ping(): void {
    this.pings += 1;
  }
}

function create(maxBufferedBytes?: number): { socket: FakeSocket; transport: WsTransport } {
  const socket = new FakeSocket();
  return { socket, transport: new WsTransport(socket as unknown as WebSocket, maxBufferedBytes) };
}

describe('WsTransport', () => {
  it('delivers binary frames as byte arrays, whatever shape ws hands over', () => {
    const { socket, transport } = create();
    const received: number[][] = [];
    transport.onMessage((data) => received.push([...data]));
    socket.emit('message', Buffer.from([1, 2]), true);
    socket.emit('message', [Buffer.from([3]), Buffer.from([4])], true);
    socket.emit('message', new Uint8Array([5, 6]).buffer, true);
    expect(received).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it('holds frames that arrive before anyone listens and replays them in order', async () => {
    const { socket, transport } = create();
    socket.emit('message', Buffer.from([1]), true);
    socket.emit('message', Buffer.from([2]), true);
    const received: number[] = [];
    transport.onMessage((data) => received.push(data[0] ?? -1));
    expect(received).toEqual([]);
    await settle(1);
    expect(received).toEqual([1, 2]);
  });

  it('closes with 1003 on a text frame', () => {
    const { socket } = create();
    socket.emit('message', Buffer.from('hello'), false);
    expect(socket.closes).toEqual([[1003, 'binary frames only']]);
  });

  it('reports a close to listeners and replays it to late ones', async () => {
    const { socket, transport } = create();
    const early: [number, string][] = [];
    transport.onClose((code, reason) => early.push([code, reason]));
    socket.emit('close', 4401, Buffer.from('denied'));
    expect(early).toEqual([[4401, 'denied']]);
    const late: [number, string][] = [];
    transport.onClose((code, reason) => late.push([code, reason]));
    await settle(1);
    expect(late).toEqual([[4401, 'denied']]);
  });

  it('does not replay a close to a listener that left', async () => {
    const { socket, transport } = create();
    socket.emit('close', 1000, Buffer.from(''));
    const calls: number[] = [];
    const unsubscribe = transport.onClose((code) => calls.push(code));
    unsubscribe();
    await settle(1);
    expect(calls).toEqual([]);
  });

  it('sends binary frames only while open', () => {
    const { socket, transport } = create();
    transport.send(new Uint8Array([1]));
    socket.readyState = 2;
    transport.send(new Uint8Array([2]));
    expect(socket.sent).toEqual([new Uint8Array([1])]);
  });

  it('closes a client that falls too far behind', () => {
    const { socket, transport } = create(100);
    socket.bufferedAmount = 101;
    transport.send(new Uint8Array([1]));
    expect(socket.sent).toEqual([]);
    expect(socket.closes).toEqual([[1013, 'client too slow']]);
  });

  it('clips long close reasons and ignores a second close', () => {
    const { socket, transport } = create();
    transport.close(1001, 'x'.repeat(500));
    expect(socket.closes[0]?.[1]?.length).toBe(120);
    socket.readyState = 2;
    transport.close(1000);
    expect(socket.closes).toHaveLength(1);
    transport.close();
    expect(socket.closes).toHaveLength(1);
  });

  it('closes without a reason', () => {
    const { socket, transport } = create();
    transport.close();
    expect(socket.closes).toEqual([[undefined, undefined]]);
  });

  it('supports ping, pong listeners, terminate and the unused open hook', () => {
    const { socket, transport } = create();
    transport.ping();
    socket.readyState = 3;
    transport.ping();
    expect(socket.pings).toBe(1);
    let pongs = 0;
    const unsubscribe = transport.onPong(() => {
      pongs += 1;
    });
    socket.emit('pong');
    unsubscribe();
    socket.emit('pong');
    expect(pongs).toBe(1);
    transport.terminate();
    expect(socket.terminated).toBe(true);
    expect(() => transport.onOpen()()).not.toThrow();
  });

  it('swallows socket errors because a close always follows', () => {
    const { socket } = create();
    expect(() => socket.emit('error', new Error('reset'))).not.toThrow();
  });
});
