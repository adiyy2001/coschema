const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export type TracePart = string | number | Uint8Array | undefined;

export function fnv1a(bytes: Uint8Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export class Trace {
  private high = FNV_OFFSET;
  private low = 0x9747b28c;
  private readonly recorded: string[] = [];
  private count = 0;

  constructor(private readonly keepLines: boolean) {}

  get eventCount(): number {
    return this.count;
  }

  get lines(): readonly string[] {
    return this.recorded;
  }

  event(...parts: TracePart[]): void {
    this.count += 1;
    const text = this.keepLines ? parts.map(describePart).join(' ') : undefined;
    if (text !== undefined) this.recorded.push(text);
    for (const part of parts) this.mixPart(part);
    this.mixByte(10);
  }

  digest(): string {
    return `${hex(this.high)}${hex(this.low)}`;
  }

  private mixPart(part: TracePart): void {
    if (part === undefined) {
      this.mixByte(0);
    } else if (typeof part === 'number') {
      this.mixNumber(part);
    } else if (typeof part === 'string') {
      for (let index = 0; index < part.length; index += 1)
        this.mixByte(part.charCodeAt(index) & 0xff);
      for (let index = 0; index < part.length; index += 1)
        this.mixByte(part.charCodeAt(index) >>> 8);
    } else {
      this.mixNumber(fnv1a(part));
      this.mixNumber(part.length);
    }
    this.mixByte(32);
  }

  private mixNumber(value: number): void {
    const scaled = Math.round(value * 1000);
    this.mixByte(scaled & 0xff);
    this.mixByte((scaled >>> 8) & 0xff);
    this.mixByte((scaled >>> 16) & 0xff);
    this.mixByte((scaled >>> 24) & 0xff);
    this.mixByte(Math.floor(scaled / 4294967296) & 0xff);
  }

  private mixByte(byte: number): void {
    this.high = Math.imul(this.high ^ byte, FNV_PRIME) >>> 0;
    this.low = Math.imul(this.low ^ (byte + 0x9b), 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
}

function hex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function describePart(part: TracePart): string {
  if (part === undefined) return '-';
  if (typeof part === 'number') return Number.isInteger(part) ? String(part) : part.toFixed(1);
  if (typeof part === 'string') return part;
  return `${part.length}B#${fnv1a(part).toString(16)}`;
}
