import { CLOSE_NORMAL, type Transport } from '@coschema/sync';

export function bridgeToServer(serverEnd: Transport, openUpstream: () => Transport): void {
  const upstream = openUpstream();
  const waiting: Uint8Array[] = [];
  let upstreamOpen = false;
  upstream.onOpen(() => {
    upstreamOpen = true;
    for (const frame of waiting.splice(0)) upstream.send(frame);
  });
  serverEnd.onMessage((frame) => {
    if (upstreamOpen) upstream.send(frame);
    else waiting.push(frame);
  });
  upstream.onMessage((frame) => {
    serverEnd.send(frame);
  });
  serverEnd.onClose(() => {
    upstream.close(CLOSE_NORMAL, 'link closed');
  });
  upstream.onClose((code, reason) => {
    serverEnd.close(code, reason);
  });
}
