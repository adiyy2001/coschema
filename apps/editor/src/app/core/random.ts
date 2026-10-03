import { InjectionToken } from '@angular/core';
import type { RandomSource } from '@coschema/model';

export const RANDOM = new InjectionToken<RandomSource>('RANDOM', {
  providedIn: 'root',
  factory: () => Math.random,
});
