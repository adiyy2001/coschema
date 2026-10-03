import type { TestProject } from 'vitest/node';
import { startTestDatabase } from '../../../../scripts/test-database';
import { buildServer } from '../../build';

declare module 'vitest' {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
    serverBundle: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [database, bundle] = await Promise.all([startTestDatabase(), buildServer()]);
  project.provide('adminDatabaseUrl', database.url);
  project.provide('serverBundle', bundle);
  return () => database.stop();
}
