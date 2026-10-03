import { arch, cpus, platform, release, totalmem } from 'node:os';

export interface Hardware {
  readonly cpuModel: string;
  readonly cores: number;
  readonly ramGiB: number;
  readonly os: string;
  readonly arch: string;
  readonly node: string;
}

export function describeHardware(): Hardware {
  const processors = cpus();
  return {
    cpuModel: processors[0]?.model.trim() ?? 'unknown',
    cores: processors.length,
    ramGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    os: `${platform()} ${release()}`,
    arch: arch(),
    node: process.version,
  };
}
