import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import { measureScene } from './measure';
import { parseGeometryOptions } from './options';
import { generateScene } from './scene';

const options = parseGeometryOptions(process.argv.slice(2));
const hardware = describeHardware();
console.log(
  `geometry bench: ${hardware.cpuModel}, ${hardware.cores} cores, ${hardware.ramGiB} GiB, ${hardware.os}, node ${hardware.node}`,
);

const scenes = options.sizes.map((size) => {
  const scene = generateScene(size, options.seed);
  const result = measureScene(scene, options.runs, options.queries, options.moves, options.seed);
  const cold = result.coldRouting;
  const median = [...cold.totalMs].sort((left, right) => left - right)[
    Math.floor(cold.totalMs.length / 2)
  ];
  console.log(
    `${size} nodes, ${result.edges} edges: route all ${median} ms (p95 ${cold.perEdgeMicroseconds.p95} us per edge, ${cold.fallbackRoutes} fallbacks), drag p95 ${result.dragRerouteMs.p95} ms`,
  );
  for (const culling of result.culling) {
    console.log(
      `  cull zoom ${culling.zoom}: ${culling.meanVisibleNodes} visible, grid p95 ${culling.gridMicroseconds.p95} us, linear scan p95 ${culling.linearScanMicroseconds.p95} us`,
    );
  }
  return result;
});

const target = await writeResult(options.output, {
  generatedAt: new Date().toISOString(),
  hardware,
  options,
  scenes,
});
console.log(`wrote ${target}`);
