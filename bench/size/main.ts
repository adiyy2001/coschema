import { Pool } from 'pg';
import { MemoryStore } from '../../apps/server/src/persistence/memory-store';
import { migrate } from '../../apps/server/src/persistence/migrate';
import { PostgresStore } from '../../apps/server/src/persistence/postgres-store';
import type { DocumentStore } from '../../apps/server/src/persistence/store';
import { startTestDatabase } from '../../scripts/test-database';
import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import { measureSize } from './measure';
import { parseSizeOptions } from './options';

const options = parseSizeOptions(process.argv.slice(2));
const hardware = describeHardware();
console.log(
  `size bench: ${hardware.cpuModel}, ${hardware.cores} cores, ${hardware.ramGiB} GiB, ${hardware.os}, node ${hardware.node}, store ${options.store}`,
);

async function withStore<T>(work: (store: DocumentStore) => Promise<T>): Promise<T> {
  if (options.store === 'memory') return work(new MemoryStore());
  const database = await startTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 4 });
  try {
    await migrate(pool);
    return await work(new PostgresStore(pool));
  } finally {
    await pool.end();
    await database.stop();
  }
}

const scenes = await withStore(async (store) => {
  const measured = [];
  for (const size of options.sizes) {
    const result = await measureSize(store, size, options.seed);
    console.log(
      `${size} nodes: ${result.updates} log rows ${result.before.bytes} bytes, snapshot ${result.after.bytes} bytes (${result.bytesRatio}x smaller), load ${result.before.loadMs} ms to ${result.after.loadMs} ms`,
    );
    measured.push(result);
  }
  return measured;
});

const target = await writeResult(options.output, {
  generatedAt: new Date().toISOString(),
  hardware,
  options,
  scenes,
});
console.log(`wrote ${target}`);
