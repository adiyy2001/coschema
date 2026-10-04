import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './files.ts';

interface Hardware {
  cpuModel: string;
  cores: number;
  ramGiB: number;
  os: string;
  node: string;
}

interface Browser {
  name: string;
  version: string;
  headless: boolean;
}

interface Summary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

interface SimResult {
  seeds: number;
  failed: number;
  durationMs: number;
  seedsPerSecond: number;
  totals: { messagesSent: number; messagesLost: number; messagesDuplicated: number };
}

interface LatencyResult {
  hardware: Hardware;
  browser: Browser;
  results: { store: string; edits: number; latencyMs: Summary }[];
}

interface PanResult {
  options: { nodes: number; runs: number; durationMs: number };
  zooms: { zoom: number; nodesInDom: number; medianFps: number; worstFps: number }[];
}

interface LoadResult {
  postgres: string;
  configuration: {
    rooms: number;
    clientsPerRoom: number;
    clients: number;
    targetOpsPerSecondPerClient: number;
    windows: number;
    windowSeconds: number;
  };
  results: {
    opsPerSecond: number;
    latencyMs: Summary;
    acknowledgementMs: Summary;
    convergedRooms: number;
    rooms: number;
    disconnects: number;
    server: { cpuPercentOfOneCore: number; peakRssMiB: number };
  };
}

interface SizeResult {
  scenes: {
    nodes: number;
    edges: number;
    updates: number;
    before: { bytes: number };
    after: { bytes: number };
    bytesRatio: number;
  }[];
}

interface GeometryResult {
  scenes: {
    nodes: number;
    edges: number;
    coldRouting: { totalMs: number[] };
    dragRerouteMs: { p95: number };
  }[];
}

interface LighthouseResult {
  lighthouse: string;
  results: { path: string; formFactor: string; score: number }[];
}

interface SaturationStep {
  offeredOpsPerSecond: number;
  achievedOpsPerSecond: number;
  deliveryP95Ms: number;
  serverCpuPercentOfOneCore: number;
  busiestGeneratorUtilization: number;
  sustained: boolean;
  stoppedBecause: string | undefined;
}

interface SaturationResult {
  configuration: { p95LimitMs: number };
  maxSustainedOpsPerSecond: number | undefined;
  steps: SaturationStep[];
}

export interface Results {
  sim: SimResult;
  latency: LatencyResult;
  pan: PanResult;
  load: LoadResult;
  saturation: SaturationResult;
  size: SizeResult;
  geometry: GeometryResult;
  lighthouse: LighthouseResult;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const separator = header.map(() => '---');
  return [row(header), row(separator), ...rows.map(row)].join('\n');
}

function hardwareLines(results: Results): string {
  const { hardware, browser } = results.latency;
  const mode = browser.headless ? 'headless' : 'headed';
  return [
    `CPU: ${hardware.cpuModel}, ${hardware.cores} logical cores, ${hardware.ramGiB} GiB RAM`,
    `OS: ${hardware.os}`,
    `Node ${hardware.node}, ${browser.name} ${browser.version} (${mode}), ${results.load.postgres}`,
  ].join('\n');
}

function simulatorSection(sim: SimResult): string {
  const seconds = (sim.durationMs / 1000).toFixed(1);
  return [
    `seeds=${grouped(sim.seeds)} failed=${sim.failed} duration=${seconds}s (${sim.seedsPerSecond} seeds per second)`,
    `messages sent ${grouped(sim.totals.messagesSent)}, lost ${grouped(sim.totals.messagesLost)}, duplicated ${grouped(sim.totals.messagesDuplicated)}`,
  ].join('\n');
}

function latencySection(latency: LatencyResult): string {
  return table(
    ['Store', 'Edits', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms'],
    latency.results.map((result) => [
      result.store,
      result.edits,
      result.latencyMs.p50,
      result.latencyMs.p95,
      result.latencyMs.p99,
      result.latencyMs.max,
    ]),
  );
}

function panSection(pan: PanResult): string {
  return table(
    ['Zoom', 'Nodes in the DOM', 'Median fps', 'Worst run fps'],
    pan.zooms.map((entry) => [entry.zoom, entry.nodesInDom, entry.medianFps, entry.worstFps]),
  );
}

function loadSection(load: LoadResult, saturation: SaturationResult): string {
  const { configuration, results } = load;
  const offered = configuration.clients * configuration.targetOpsPerSecondPerClient;
  const ramp = table(
    [
      'Offered ops/s',
      'Completed ops/s',
      'Delivery p95 ms',
      'Server CPU, % of one core',
      'Sustained',
    ],
    saturation.steps.map((step) => [
      grouped(step.offeredOpsPerSecond),
      grouped(Math.round(step.achievedOpsPerSecond)),
      step.deliveryP95Ms,
      step.serverCpuPercentOfOneCore,
      step.sustained ? 'yes' : `no, ${step.stoppedBecause ?? ''}`,
    ]),
  );
  return [
    `${configuration.rooms} rooms with ${configuration.clientsPerRoom} clients each, ${configuration.windows} windows of ${configuration.windowSeconds} s. The generator offers ${grouped(offered)} operations per second (${configuration.targetOpsPerSecondPerClient} per client) and the server completed ${grouped(results.opsPerSecond)} of them, so this run shows the latency at a fixed load, not the capacity.`,
    `delivery to another client p50 ${results.latencyMs.p50} ms, p95 ${results.latencyMs.p95} ms, p99 ${results.latencyMs.p99} ms`,
    `persistence ack p95 ${results.acknowledgementMs.p95} ms`,
    `${results.convergedRooms} of ${results.rooms} rooms converged, ${results.disconnects} disconnects`,
    `server ${results.server.cpuPercentOfOneCore}% of one core, peak RSS ${results.server.peakRssMiB} MiB`,
    `Saturation ramp, ${saturation.configuration.p95LimitMs} ms p95 limit, maximum sustained ${grouped(Math.round(saturation.maxSustainedOpsPerSecond ?? 0))} operations per second:`,
    ramp,
  ].join('\n');
}

function sizeSection(size: SizeResult): string {
  return table(
    ['Nodes', 'Edges', 'Log updates', 'Log bytes', 'Snapshot bytes', 'Smaller by'],
    size.scenes.map((scene) => [
      grouped(scene.nodes),
      grouped(scene.edges),
      grouped(scene.updates),
      grouped(scene.before.bytes),
      grouped(scene.after.bytes),
      `${scene.bytesRatio}x`,
    ]),
  );
}

function geometrySection(geometry: GeometryResult): string {
  return table(
    ['Nodes', 'Edges', 'Route every edge, median ms', 'Move one node and reroute, p95 ms'],
    geometry.scenes.map((scene) => [
      grouped(scene.nodes),
      grouped(scene.edges),
      median(scene.coldRouting.totalMs),
      scene.dragRerouteMs.p95,
    ]),
  );
}

function lighthouseSection(lighthouse: LighthouseResult): string {
  return table(
    ['Page', 'Form factor', 'Accessibility score'],
    lighthouse.results.map((entry) => [entry.path, entry.formFactor, entry.score]),
  );
}

export function buildReport(results: Results): string {
  const sections: [string, string][] = [
    ['Hardware', hardwareLines(results)],
    ['Convergence simulator', simulatorSection(results.sim)],
    ['Edit to remote render latency', latencySection(results.latency)],
    [`Panning with ${grouped(results.pan.options.nodes)} nodes`, panSection(results.pan)],
    ['Load test', loadSection(results.load, results.saturation)],
    ['Document size before and after compaction', sizeSection(results.size)],
    ['Routing', geometrySection(results.geometry)],
    [`Lighthouse ${results.lighthouse.lighthouse}`, lighthouseSection(results.lighthouse)],
  ];
  return sections.map(([title, body]) => `## ${title}\n\n${body}`).join('\n\n');
}

function readResult<T>(name: string): T {
  const file = resolve(repoRoot, 'bench/results', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function readResults(): Results {
  return {
    sim: readResult('sim'),
    latency: readResult('latency'),
    pan: readResult('pan'),
    load: readResult('load'),
    saturation: readResult('load-saturation'),
    size: readResult('size'),
    geometry: readResult('geometry'),
    lighthouse: readResult('lighthouse'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${buildReport(readResults())}\n`);
}
