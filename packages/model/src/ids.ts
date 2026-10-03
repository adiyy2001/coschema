import { randomDigits, type RandomSource } from './base62';

export type NodeId = string;
export type EdgeId = string;

export const ID_LENGTH = 16;

export function createId(random: RandomSource): string {
  return randomDigits(random, ID_LENGTH);
}
