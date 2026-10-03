import { WebSocket } from 'ws';
import type { RunningApp } from './app';

export interface RawSocket {
  readonly socket: WebSocket;
  readonly frames: Uint8Array[];
  readonly closed: Promise<number>;
  readonly opened: Promise<void>;
}

export function openRawSocket(app: RunningApp, room: string): RawSocket {
  const socket = new WebSocket(`${app.wsUrl}/rooms/${room}`);
  const frames: Uint8Array[] = [];
  socket.on('message', (data: Buffer) => frames.push(new Uint8Array(data)));
  const closed = new Promise<number>((resolve) => {
    socket.on('close', (code) => resolve(code));
    socket.on('error', () => undefined);
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  return { socket, frames, closed, opened };
}
