import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as authProtocol from 'y-protocols/auth';
import * as Y from 'yjs';

export const SYNC_STEP_1 = syncProtocol.messageYjsSyncStep1;
export const SYNC_STEP_2 = syncProtocol.messageYjsSyncStep2;
export const SYNC_UPDATE = syncProtocol.messageYjsUpdate;

export const MessageType = {
  sync: 0,
  awareness: 1,
  auth: 2,
  queryAwareness: 3,
  ack: 4,
  flush: 5,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export type Envelope =
  | { readonly type: typeof MessageType.sync; readonly decoder: decoding.Decoder }
  | { readonly type: typeof MessageType.awareness; readonly update: Uint8Array }
  | { readonly type: typeof MessageType.auth; readonly decoder: decoding.Decoder }
  | { readonly type: typeof MessageType.queryAwareness }
  | { readonly type: typeof MessageType.ack; readonly decoder: decoding.Decoder }
  | { readonly type: typeof MessageType.flush; readonly token: number };

export interface Ack {
  readonly token: number;
  readonly stateVector: Uint8Array;
}

export class MalformedFrameError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MalformedFrameError';
  }
}

function createFrame(type: MessageTypeValue): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  return encoder;
}

export function openSyncFrame(): encoding.Encoder {
  return createFrame(MessageType.sync);
}

export function frameBytes(encoder: encoding.Encoder): Uint8Array {
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = openSyncFrame();
  syncProtocol.writeSyncStep1(encoder, doc);
  return frameBytes(encoder);
}

export function encodeSyncStep2(doc: Y.Doc, stateVector: Uint8Array): Uint8Array {
  const encoder = openSyncFrame();
  syncProtocol.writeSyncStep2(encoder, doc, stateVector);
  return frameBytes(encoder);
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = openSyncFrame();
  syncProtocol.writeUpdate(encoder, update);
  return frameBytes(encoder);
}

export function encodeAwarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = createFrame(MessageType.awareness);
  encoding.writeVarUint8Array(encoder, update);
  return frameBytes(encoder);
}

export function encodeAwarenessOf(
  awareness: awarenessProtocol.Awareness,
  clients: readonly number[],
): Uint8Array {
  return encodeAwarenessFrame(awarenessProtocol.encodeAwarenessUpdate(awareness, [...clients]));
}

export function encodeQueryAwareness(): Uint8Array {
  return frameBytes(createFrame(MessageType.queryAwareness));
}

export function encodeAuthToken(token: string): Uint8Array {
  const encoder = createFrame(MessageType.auth);
  encoding.writeVarString(encoder, token);
  return frameBytes(encoder);
}

export function encodeAuthDenied(reason: string): Uint8Array {
  const encoder = createFrame(MessageType.auth);
  authProtocol.writePermissionDenied(encoder, reason);
  return frameBytes(encoder);
}

export function encodeFlush(token: number): Uint8Array {
  const encoder = createFrame(MessageType.flush);
  encoding.writeVarUint(encoder, token);
  return frameBytes(encoder);
}

export function encodeAck(ack: Ack): Uint8Array {
  const encoder = createFrame(MessageType.ack);
  encoding.writeVarUint(encoder, ack.token);
  encoding.writeVarUint8Array(encoder, ack.stateVector);
  return frameBytes(encoder);
}

export function decodeEnvelope(data: Uint8Array): Envelope {
  try {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MessageType.sync:
        return { type, decoder };
      case MessageType.awareness:
        return { type, update: decoding.readVarUint8Array(decoder) };
      case MessageType.auth:
        return { type, decoder };
      case MessageType.queryAwareness:
        return { type };
      case MessageType.ack:
        return { type, decoder };
      case MessageType.flush:
        return { type, token: decoding.readVarUint(decoder) };
      default:
        throw new MalformedFrameError(`unknown message type ${type}`);
    }
  } catch (error) {
    if (error instanceof MalformedFrameError) throw error;
    throw new MalformedFrameError('frame could not be decoded');
  }
}

export function decodeAck(decoder: decoding.Decoder): Ack {
  try {
    const token = decoding.readVarUint(decoder);
    return { token, stateVector: decoding.readVarUint8Array(decoder) };
  } catch {
    throw new MalformedFrameError('ack could not be decoded');
  }
}

export function decodeAuthToken(decoder: decoding.Decoder): string {
  try {
    return decoding.readVarString(decoder);
  } catch {
    throw new MalformedFrameError('auth token could not be decoded');
  }
}

export function decodeAuthDenied(decoder: decoding.Decoder): string {
  try {
    if (decoding.readVarUint(decoder) !== authProtocol.messagePermissionDenied) {
      throw new MalformedFrameError('unknown auth message');
    }
    return decoding.readVarString(decoder);
  } catch (error) {
    if (error instanceof MalformedFrameError) throw error;
    throw new MalformedFrameError('auth message could not be decoded');
  }
}

export interface SyncOutcome {
  readonly messageType: number;
  readonly reply: Uint8Array | undefined;
}

export function readSyncFrame(decoder: decoding.Decoder, doc: Y.Doc, origin: unknown): SyncOutcome {
  let messageType: number;
  let payload: Uint8Array;
  try {
    messageType = decoding.readVarUint(decoder);
    payload = decoding.readVarUint8Array(decoder);
  } catch {
    throw new MalformedFrameError('sync message could not be decoded');
  }
  if (messageType === SYNC_STEP_1) {
    const encoder = openSyncFrame();
    try {
      syncProtocol.writeSyncStep2(encoder, doc, payload);
    } catch {
      throw new MalformedFrameError('state vector could not be decoded');
    }
    return { messageType, reply: frameBytes(encoder) };
  }
  if (messageType !== SYNC_STEP_2 && messageType !== SYNC_UPDATE) {
    throw new MalformedFrameError(`unknown sync message ${messageType}`);
  }
  try {
    Y.applyUpdate(doc, payload, origin);
  } catch (error) {
    throw new MalformedFrameError('update could not be applied', { cause: error });
  }
  return { messageType, reply: undefined };
}
