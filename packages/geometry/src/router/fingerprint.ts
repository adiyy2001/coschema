import type { GridEntry } from '../spatial-grid';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const scratch = new Float64Array(1);
const scratchWords = new Uint32Array(scratch.buffer);

function mixWord(hash: number, word: number): number {
  return Math.imul(hash ^ word, FNV_PRIME) >>> 0;
}

function mixNumber(hash: number, value: number): number {
  scratch[0] = value;
  return mixWord(mixWord(hash, scratchWords[0] ?? 0), scratchWords[1] ?? 0);
}

function mixText(hash: number, text: string): number {
  let result = hash;
  for (let index = 0; index < text.length; index += 1) {
    result = mixWord(result, text.charCodeAt(index));
  }
  return result;
}

export function fingerprintEntries(entries: readonly GridEntry<string>[]): string {
  let sum = 0;
  let xor = 0;
  for (const entry of entries) {
    let hash = mixText(FNV_OFFSET, entry.id);
    hash = mixNumber(hash, entry.rect.x);
    hash = mixNumber(hash, entry.rect.y);
    hash = mixNumber(hash, entry.rect.width);
    hash = mixNumber(hash, entry.rect.height);
    sum = (sum + hash) >>> 0;
    xor = (xor ^ hash) >>> 0;
  }
  return `${entries.length}.${sum.toString(36)}.${xor.toString(36)}`;
}
