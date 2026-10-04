import { writeResult } from '../lib/results';
import { parseOptions } from './options';
import { runLoad } from './run';

const options = parseOptions(process.argv.slice(2));
const { result, converged } = await runLoad(options);
const target = await writeResult(options.output, result);
console.log(`written to ${target}`);
if (!converged) process.exitCode = 1;
