import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'bench',
    loadComponent: () => import('./shell/bench-page.component').then((m) => m.BenchPageComponent),
  },
];
