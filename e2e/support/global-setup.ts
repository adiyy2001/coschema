import { resolve } from 'node:path';
import { startStaticServer } from '../../scripts/static-server';
import { E2E_PORT } from '../playwright.config';

const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await startStaticServer(EDITOR_ROOT, E2E_PORT, '127.0.0.1');
  return () => server.close();
}
