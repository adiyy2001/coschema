import { resolve } from 'node:path';
import { startStaticServer } from '../../scripts/static-server';
import { startSyncServer } from '../../scripts/sync-server-process';
import { E2E_PORT, SYNC_PORT } from '../playwright.config';

const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');

export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env['E2E_DATABASE_URL'];
  const editor = await startStaticServer(EDITOR_ROOT, E2E_PORT, '127.0.0.1');
  const sync = await startSyncServer({
    port: SYNC_PORT,
    allowedOrigins: [`http://127.0.0.1:${E2E_PORT}`],
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  });
  return async () => {
    await editor.close();
    await sync.stop();
  };
}
