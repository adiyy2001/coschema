import {
  BASE62_SIZE,
  LOWEST_DIGIT,
  digitAt,
  digitValue,
  isBase62,
  randomDigit,
  randomDigits,
  type RandomSource,
} from './base62';

export const RANDOM_SUFFIX_LENGTH = 4;

export class InvalidOrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrderKeyError';
  }
}

export function isValidOrderKey(key: string): boolean {
  return key.length > 0 && isBase62(key) && !key.endsWith(LOWEST_DIGIT);
}

export function compareOrderKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertValid(key: string, role: string): void {
  if (!isValidOrderKey(key)) {
    throw new InvalidOrderKeyError(`invalid ${role} key: ${JSON.stringify(key)}`);
  }
}

function midpoint(lower: string, upper: string | undefined): string {
  if (upper !== undefined) {
    let shared = 0;
    while ((lower[shared] ?? LOWEST_DIGIT) === upper[shared]) shared += 1;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }
  const lowerDigit = lower === '' ? 0 : digitValue(lower.charAt(0));
  const upperDigit = upper === undefined ? BASE62_SIZE : digitValue(upper.charAt(0));
  if (lower === '' && upper === undefined) return digitAt(BASE62_SIZE >> 1);
  if (upper === undefined && lowerDigit < BASE62_SIZE - 1) return digitAt(lowerDigit + 1);
  if (lower === '' && upperDigit > 1) return digitAt(upperDigit - 1);
  if (upperDigit - lowerDigit > 1) {
    return digitAt(Math.floor((lowerDigit + upperDigit) / 2));
  }
  if (upper !== undefined && upper.length > 1) {
    return upper.charAt(0);
  }
  return digitAt(lowerDigit) + midpoint(lower.slice(1), undefined);
}

function randomSuffix(upperRemainder: string | undefined, random: RandomSource): string {
  if (upperRemainder !== undefined) return between(undefined, upperRemainder, random);
  const head = randomDigits(random, RANDOM_SUFFIX_LENGTH - 1);
  return head + digitAt(randomDigit(random, 1));
}

export function between(
  lower: string | undefined,
  upper: string | undefined,
  random: RandomSource,
): string {
  if (lower !== undefined) assertValid(lower, 'lower');
  if (upper !== undefined) assertValid(upper, 'upper');
  if (lower !== undefined && upper !== undefined && lower >= upper) {
    throw new InvalidOrderKeyError(
      `lower bound ${lower} must be smaller than upper bound ${upper}`,
    );
  }
  const base = midpoint(lower ?? '', upper);
  const crowded = upper !== undefined && upper.startsWith(base);
  const suffix = randomSuffix(crowded ? upper.slice(base.length) : undefined, random);
  return base + suffix;
}

export function after(key: string, random: RandomSource): string {
  return between(key, undefined, random);
}

export function before(key: string, random: RandomSource): string {
  return between(undefined, key, random);
}

export function first(random: RandomSource): string {
  return between(undefined, undefined, random);
}

export function sequenceAfter(
  key: string | undefined,
  count: number,
  random: RandomSource,
): string[] {
  const keys: string[] = [];
  let previous = key;
  for (let index = 0; index < count; index += 1) {
    previous = between(previous, undefined, random);
    keys.push(previous);
  }
  return keys;
}
