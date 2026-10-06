import { InjectionToken } from '@angular/core';

export interface PageNavigation {
  open(path: string): void;
  readonly search: string;
}

export const PAGE_NAVIGATION = new InjectionToken<PageNavigation>('PAGE_NAVIGATION', {
  providedIn: 'root',
  factory: () => ({
    open: (path) => {
      globalThis.location.assign(path);
    },
    get search() {
      return globalThis.location.search;
    },
  }),
});

export function roomPath(room: string, search: string): string {
  return `r/${encodeURIComponent(room)}${search}`;
}
