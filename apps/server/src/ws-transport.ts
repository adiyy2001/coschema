import type { Transport, Unsubscribe } from '@coschema/sync';
import { WebSocket, type RawData } from 'ws';

const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_OVERLOADED = 1013;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const MAX_CLOSE_REASON_BYTES = 120;

type MessageHandler = (data: Uint8Array) => void;
type CloseHandler = (code: number, reason: string) => void;

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function clipReason(reason: string): string {
  return Buffer.from(reason).subarray(0, MAX_CLOSE_REASON_BYTES).toString();
}

export class WsTransport implements Transport {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();
  private readonly early: Uint8Array[] = [];
  private closedWith: { code: number; reason: string } | undefined;
  private replayScheduled = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly maxBufferedBytes = MAX_BUFFERED_BYTES,
  ) {
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        this.close(CLOSE_UNSUPPORTED_DATA, 'binary frames only');
        return;
      }
      this.receive(toBytes(data));
    });
    socket.on('close', (code, reason) => {
      this.closedWith = { code, reason: reason.toString() };
      for (const handler of [...this.closeHandlers]) handler(code, this.closedWith.reason);
    });
    socket.on('error', () => undefined);
  }

  send(data: Uint8Array): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.close(CLOSE_OVERLOADED, 'client too slow');
      return;
    }
    this.socket.send(data, { binary: true }, () => undefined);
  }

  close(code?: number, reason?: string): void {
    if (
      this.socket.readyState === WebSocket.CLOSING ||
      this.socket.readyState === WebSocket.CLOSED
    ) {
      return;
    }
    this.socket.close(code, reason === undefined ? undefined : clipReason(reason));
  }

  terminate(): void {
    this.socket.terminate();
  }

  ping(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.ping();
  }

  onPong(handler: () => void): Unsubscribe {
    this.socket.on('pong', handler);
    return () => {
      this.socket.off('pong', handler);
    };
  }

  onOpen(): Unsubscribe {
    return () => undefined;
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    this.scheduleReplay();
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onClose(handler: CloseHandler): Unsubscribe {
    this.closeHandlers.add(handler);
    if (this.closedWith !== undefined) {
      const { code, reason } = this.closedWith;
      queueMicrotask(() => {
        if (this.closeHandlers.has(handler)) handler(code, reason);
      });
    }
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  private receive(data: Uint8Array): void {
    if (this.messageHandlers.size === 0) {
      this.early.push(data);
      return;
    }
    for (const handler of [...this.messageHandlers]) handler(data);
  }

  private scheduleReplay(): void {
    if (this.replayScheduled || this.early.length === 0) return;
    this.replayScheduled = true;
    queueMicrotask(() => {
      this.replayScheduled = false;
      for (const data of this.early.splice(0)) this.receive(data);
    });
  }
}
