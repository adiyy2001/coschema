export function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? Number.NaN;
}
