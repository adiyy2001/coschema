import { Emitter } from './emitter';
import { CLOSE_ABNORMAL, CLOSE_NORMAL, type Transport, type Unsubscribe } from './transport';

export type WebSocketFactory = (url: string) => WebSocket;

const OPEN_STATE = 1;

export function createWebSocketTransport(
  url: string,
  create: WebSocketFactory = (target) => new WebSocket(target),
): Transport {
  const socket = create(url);
  socket.binaryType = 'arraybuffer';
  const openEvents = new Emitter<[]>();
  const messageEvents = new Emitter<[Uint8Array]>();
  const closeEvents = new Emitter<[number, string]>();
  socket.addEventListener('open', () => {
    openEvents.emit();
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) messageEvents.emit(new Uint8Array(event.data));
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    closeEvents.emit(event.code || CLOSE_ABNORMAL, event.reason);
  });
  return {
    send: (data) => {
      if (socket.readyState === OPEN_STATE) socket.send(new Uint8Array(data));
    },
    close: (code = CLOSE_NORMAL, reason = '') => {
      try {
        socket.close(code, reason);
      } catch {
        socket.close();
      }
    },
    onOpen: (handler): Unsubscribe => openEvents.subscribe(handler),
    onMessage: (handler): Unsubscribe => messageEvents.subscribe(handler),
    onClose: (handler): Unsubscribe => closeEvents.subscribe(handler),
  };
}
