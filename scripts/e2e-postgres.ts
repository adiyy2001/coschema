import { spawn } from 'node:child_process';
import { startTestDatabase } from './test-database';

const database = await startTestDatabase();
try {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@coschema/e2e', 'exec', 'playwright', 'test', ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: { ...process.env, E2E_DATABASE_URL: database.url },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await database.stop();
}
