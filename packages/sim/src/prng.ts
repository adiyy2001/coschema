import type { RandomSource } from '@coschema/model';

const UINT32 = 4294967296;

function mixSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad);
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97);
    value ^= value >>> 15;
    return value >>> 0;
  };
}

export function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private readonly origin: readonly [number, number, number, number];

  constructor(words: readonly [number, number, number, number]) {
    this.origin = words;
    [this.a, this.b, this.c, this.d] = words;
    for (let warmup = 0; warmup < 15; warmup += 1) this.nextUint32();
  }

  static fromSeed(seed: number): Prng {
    const mix = mixSeed(seed);
    return new Prng([mix(), mix(), mix(), mix()]);
  }

  nextUint32(): number {
    const result = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + result) >>> 0;
    return result;
  }

  next(): number {
    return this.nextUint32() / UINT32;
  }

  int(limit: number): number {
    return Math.min(limit - 1, Math.floor(this.next() * limit));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new RangeError('cannot pick from an empty list');
    return item;
  }

  split(label: string | number): Prng {
    const salt = hashLabel(String(label));
    const mix = mixSeed(salt ^ this.origin[0]);
    return new Prng([
      (mix() ^ this.origin[1]) >>> 0,
      (mix() ^ this.origin[2]) >>> 0,
      (mix() ^ this.origin[3]) >>> 0,
      mix(),
    ]);
  }

  source(): RandomSource {
    return () => this.next();
  }
}
