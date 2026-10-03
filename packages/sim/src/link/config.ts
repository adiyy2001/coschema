export interface LinkConfig {
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly lossRate: number;
  readonly duplicateRate: number;
  readonly reorderRate: number;
  readonly reorderDelayMs: number;
}

export const LINK_PROFILE_NAMES = ['clean', 'slow', 'lossy', 'chaotic'] as const;
export type LinkProfileName = (typeof LINK_PROFILE_NAMES)[number];

export const LINK_PROFILES: Readonly<Record<LinkProfileName, LinkConfig>> = {
  clean: {
    latencyMs: 5,
    jitterMs: 0,
    lossRate: 0,
    duplicateRate: 0,
    reorderRate: 0,
    reorderDelayMs: 0,
  },
  slow: {
    latencyMs: 250,
    jitterMs: 120,
    lossRate: 0,
    duplicateRate: 0,
    reorderRate: 0.1,
    reorderDelayMs: 400,
  },
  lossy: {
    latencyMs: 60,
    jitterMs: 40,
    lossRate: 0.2,
    duplicateRate: 0.05,
    reorderRate: 0.1,
    reorderDelayMs: 200,
  },
  chaotic: {
    latencyMs: 150,
    jitterMs: 300,
    lossRate: 0.3,
    duplicateRate: 0.3,
    reorderRate: 0.4,
    reorderDelayMs: 800,
  },
};

export function isLinkProfileName(value: string): value is LinkProfileName {
  return (LINK_PROFILE_NAMES as readonly string[]).includes(value);
}

export function validateLinkConfig(config: LinkConfig): LinkConfig {
  const rates = [config.lossRate, config.duplicateRate, config.reorderRate];
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new RangeError('link rates must be between 0 and 1');
  }
  const durations = [config.latencyMs, config.jitterMs, config.reorderDelayMs];
  if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
    throw new RangeError('link durations must not be negative');
  }
  return config;
}
