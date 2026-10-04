import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import { parseOptions, type LoadOptions } from './options';
import { runLoad, type LoadSummary } from './run';

const RATES_PER_CLIENT = [4, 8, 16, 32, 64, 128];
const P95_LIMIT_MS = 200;
const MIN_DELIVERED_SHARE = 0.95;
const GENERATOR_LIMIT = 0.9;

interface Step {
  readonly offeredOpsPerSecond: number;
  readonly achievedOpsPerSecond: number;
  readonly deliveryP95Ms: number;
  readonly deliveryP99Ms: number;
  readonly acknowledgementP95Ms: number;
  readonly serverCpuPercentOfOneCore: number;
  readonly busiestGeneratorUtilization: number;
  readonly disconnects: number;
  readonly converged: boolean;
  readonly sustained: boolean;
  readonly stoppedBecause: string | undefined;
}

function judge(offered: number, summary: LoadSummary, converged: boolean): Step {
  const reasons: string[] = [];
  if (summary.deliveryP95Ms > P95_LIMIT_MS) reasons.push(`delivery p95 above ${P95_LIMIT_MS} ms`);
  if (summary.operationsPerSecond < offered * MIN_DELIVERED_SHARE) {
    reasons.push('completed less than 95% of the offered operations');
  }
  if (summary.busiestGeneratorUtilization > GENERATOR_LIMIT) {
    reasons.push('the load generator is the bottleneck');
  }
  if (!converged) reasons.push('a room did not converge');
  if (summary.disconnects > 0) reasons.push('clients were disconnected');
  return {
    offeredOpsPerSecond: offered,
    achievedOpsPerSecond: summary.operationsPerSecond,
    deliveryP95Ms: summary.deliveryP95Ms,
    deliveryP99Ms: summary.deliveryP99Ms,
    acknowledgementP95Ms: summary.acknowledgementP95Ms,
    serverCpuPercentOfOneCore: summary.serverCpuPercentOfOneCore,
    busiestGeneratorUtilization: summary.busiestGeneratorUtilization,
    disconnects: summary.disconnects,
    converged,
    sustained: reasons.length === 0,
    stoppedBecause: reasons.length === 0 ? undefined : reasons.join(', '),
  };
}

function stepOptions(base: LoadOptions, rate: number): LoadOptions {
  return { ...base, opsPerSecondPerClient: rate, windows: 2, windowSeconds: 5, warmupSeconds: 3 };
}

const base = parseOptions(process.argv.slice(2));
const steps: Step[] = [];
for (const rate of RATES_PER_CLIENT) {
  const offered = rate * base.rooms * base.clientsPerRoom;
  console.log(`step: ${rate} ops/s per client, ${offered} offered`);
  const { summary, converged } = await runLoad(stepOptions(base, rate));
  const step = judge(offered, summary, converged);
  steps.push(step);
  if (!step.sustained) break;
}
const sustained = steps.filter((step) => step.sustained);
const best = sustained[sustained.length - 1];
const limit = steps.find((step) => !step.sustained);
await writeResult('load-saturation', {
  generatedAt: new Date().toISOString(),
  hardware: describeHardware(),
  configuration: {
    store: base.store,
    rooms: base.rooms,
    clientsPerRoom: base.clientsPerRoom,
    ratesPerClient: RATES_PER_CLIENT,
    windowsPerStep: 2,
    windowSeconds: 5,
    p95LimitMs: P95_LIMIT_MS,
    minDeliveredShare: MIN_DELIVERED_SHARE,
  },
  maxSustainedOpsPerSecond: best?.achievedOpsPerSecond,
  firstFailingStep: limit,
  steps,
  notes: [
    'Every step is a fresh server and a fresh database. A step counts as sustained when delivery p95 stays under the limit, at least 95% of the offered operations complete, every room converges, nobody is disconnected and the load generator itself is below 90% event loop utilization.',
    'When the first failing step names the load generator, the sustained rate is a lower bound: the server was not the bottleneck.',
  ],
});
console.log(`maximum sustained rate ${best?.achievedOpsPerSecond ?? 'none'} ops/s`);
