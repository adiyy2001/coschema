import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  MalformedFrameError,
  MessageType,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeAck,
  decodeAuthDenied,
  decodeAuthToken,
  decodeEnvelope,
  encodeAck,
  encodeAuthDenied,
  encodeAuthToken,
  encodeFlush,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  readSyncFrame,
} from '../src';

function docWith(entries: Record<string, string>, clientId: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  for (const [key, value] of Object.entries(entries)) doc.getMap<string>('labels').set(key, value);
  return doc;
}

function envelopeOf(frame: Uint8Array) {
  return decodeEnvelope(frame);
}

describe('envelope', () => {
  it('starts with the message type as a varUint', () => {
    expect(decodeEnvelope(encodeQueryAwareness()).type).toBe(MessageType.queryAwareness);
    expect(decodeEnvelope(encodeSyncStep1(new Y.Doc())).type).toBe(MessageType.sync);
  });

  it('round trips the auth token', () => {
    const envelope = envelopeOf(encodeAuthToken('a.b.c'));
    expect(envelope.type).toBe(MessageType.auth);
    if (envelope.type === MessageType.auth) {
      expect(decodeAuthToken(envelope.decoder)).toBe('a.b.c');
    }
  });

  it('round trips a denial reason', () => {
    const envelope = envelopeOf(encodeAuthDenied('expired'));
    if (envelope.type !== MessageType.auth) throw new Error('wrong type');
    expect(decodeAuthDenied(envelope.decoder)).toBe('expired');
  });

  it('round trips a flush token and an ack', () => {
    const flush = envelopeOf(encodeFlush(41));
    expect(flush).toEqual({ type: MessageType.flush, token: 41 });
    const stateVector = Y.encodeStateVector(docWith({ a: '1' }, 5));
    const ack = envelopeOf(encodeAck({ token: 7, stateVector }));
    if (ack.type !== MessageType.ack) throw new Error('wrong type');
    expect(decodeAck(ack.decoder)).toEqual({ token: 7, stateVector });
  });

  it('rejects unknown types, empty frames and truncated payloads', () => {
    expect(() => decodeEnvelope(new Uint8Array([99]))).toThrow(MalformedFrameError);
    expect(() => decodeEnvelope(new Uint8Array([]))).toThrow(MalformedFrameError);
    expect(() => decodeEnvelope(new Uint8Array([MessageType.flush]))).toThrow(MalformedFrameError);
    expect(() => decodeEnvelope(new Uint8Array([MessageType.awareness, 5, 1]))).toThrow(
      MalformedFrameError,
    );
  });

  it('rejects broken ack and auth payloads', () => {
    expect(() => decodeAck(decoding.createDecoder(new Uint8Array([1])))).toThrow(
      MalformedFrameError,
    );
    expect(() => decodeAuthToken(decoding.createDecoder(new Uint8Array([9, 1])))).toThrow(
      MalformedFrameError,
    );
    expect(() => decodeAuthDenied(decoding.createDecoder(new Uint8Array([])))).toThrow(
      MalformedFrameError,
    );
    expect(() => decodeAuthDenied(decoding.createDecoder(new Uint8Array([4, 1, 65])))).toThrow(
      MalformedFrameError,
    );
  });
});

describe('sync frames', () => {
  function syncDecoder(frame: Uint8Array): decoding.Decoder {
    const envelope = decodeEnvelope(frame);
    if (envelope.type !== MessageType.sync) throw new Error('wrong type');
    return envelope.decoder;
  }

  it('answers step 1 with only the missing structs', () => {
    const server = docWith({ a: '1', b: '2' }, 1);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    server.getMap<string>('labels').set('c', '3');
    const outcome = readSyncFrame(syncDecoder(encodeSyncStep1(client)), server, 'origin');
    expect(outcome.messageType).toBe(SYNC_STEP_1);
    expect(outcome.reply).toBeDefined();
    const reply = outcome.reply ?? new Uint8Array();
    const target = new Y.Doc();
    Y.applyUpdate(target, Y.encodeStateAsUpdate(client));
    const applied = readSyncFrame(syncDecoder(reply), target, 'origin');
    expect(applied.messageType).toBe(SYNC_STEP_2);
    expect(target.getMap('labels').toJSON()).toEqual({ a: '1', b: '2', c: '3' });
    expect(reply.length).toBeLessThan(Y.encodeStateAsUpdate(server).length + 4);
  });

  it('applies updates with the given origin', () => {
    const source = docWith({ a: '1' }, 1);
    const target = new Y.Doc();
    const origins: unknown[] = [];
    target.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    const update = Y.encodeStateAsUpdate(source);
    const outcome = readSyncFrame(syncDecoder(encodeUpdate(update)), target, 'peer');
    expect(outcome).toEqual({ messageType: SYNC_UPDATE, reply: undefined });
    expect(origins).toEqual(['peer']);
  });

  it('rejects a corrupt update and an unknown sync type', () => {
    const target = new Y.Doc();
    expect(() =>
      readSyncFrame(syncDecoder(encodeUpdate(new Uint8Array([255, 255, 255]))), target, null),
    ).toThrow(MalformedFrameError);
    const brokenStep1 = encoding.createEncoder();
    encoding.writeVarUint(brokenStep1, MessageType.sync);
    encoding.writeVarUint(brokenStep1, SYNC_STEP_1);
    encoding.writeVarUint8Array(brokenStep1, new Uint8Array([255, 255, 255]));
    expect(() =>
      readSyncFrame(syncDecoder(encoding.toUint8Array(brokenStep1)), target, null),
    ).toThrow(MalformedFrameError);
    const unknown = encoding.createEncoder();
    encoding.writeVarUint(unknown, MessageType.sync);
    encoding.writeVarUint(unknown, 9);
    encoding.writeVarUint8Array(unknown, new Uint8Array());
    expect(() => readSyncFrame(syncDecoder(encoding.toUint8Array(unknown)), target, null)).toThrow(
      MalformedFrameError,
    );
    const truncated = encoding.createEncoder();
    encoding.writeVarUint(truncated, MessageType.sync);
    expect(() =>
      readSyncFrame(syncDecoder(encoding.toUint8Array(truncated)), target, null),
    ).toThrow(MalformedFrameError);
  });

  it('builds a step 2 frame for a state vector', () => {
    const doc = docWith({ a: '1' }, 3);
    const frame = encodeSyncStep2(doc, Y.encodeStateVector(new Y.Doc()));
    const target = new Y.Doc();
    readSyncFrame(syncDecoder(frame), target, null);
    expect(target.getMap('labels').toJSON()).toEqual({ a: '1' });
  });
});
