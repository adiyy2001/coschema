export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const BASE62_SIZE = BASE62_ALPHABET.length;
export const LOWEST_DIGIT = BASE62_ALPHABET.charAt(0);

export type RandomSource = () => number;

const DIGIT_VALUES: ReadonlyMap<string, number> = new Map(
  BASE62_ALPHABET.split('').map((digit, value) => [digit, value]),
);

export function digitValue(digit: string): number {
  const value = DIGIT_VALUES.get(digit);
  if (value === undefined) throw new RangeError(`not a base 62 digit: ${digit}`);
  return value;
}

export function digitAt(value: number): string {
  const digit = BASE62_ALPHABET[value];
  if (digit === undefined) throw new RangeError(`not a base 62 value: ${value}`);
  return digit;
}

export function isBase62(text: string): boolean {
  for (const character of text) {
    if (!DIGIT_VALUES.has(character)) return false;
  }
  return true;
}

export function randomDigit(random: RandomSource, minimum = 0): number {
  const span = BASE62_SIZE - minimum;
  const value = minimum + Math.floor(random() * span);
  return Math.min(BASE62_SIZE - 1, Math.max(minimum, value));
}

export function randomDigits(random: RandomSource, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += digitAt(randomDigit(random));
  }
  return result;
}

export function cryptoRandom(): number {
  const buffer = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buffer);
  const high = buffer[0] ?? 0;
  const low = buffer[1] ?? 0;
  return (high * 2 ** 21 + (low >>> 11)) / 2 ** 53;
}
