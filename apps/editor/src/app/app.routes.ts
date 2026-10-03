import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./shell/editor-page.component').then((m) => m.EditorPageComponent),
  },
  {
    path: 'r/:room',
    loadComponent: () => import('./shell/room-page.component').then((m) => m.RoomPageComponent),
  },
  {
    path: 'bench',
    loadComponent: () => import('./shell/bench-page.component').then((m) => m.BenchPageComponent),
  },
  { path: '**', redirectTo: '' },
];
