export type Unsubscribe = () => void;

export interface Transport {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): Unsubscribe;
  onMessage(handler: (data: Uint8Array) => void): Unsubscribe;
  onClose(handler: (code: number, reason: string) => void): Unsubscribe;
}

export const CLOSE_NORMAL = 1000;
export const CLOSE_ABNORMAL = 1006;
export const CLOSE_INVALID_DATA = 1007;
export const CLOSE_POLICY = 1008;
export const CLOSE_UNAUTHORIZED = 4401;
