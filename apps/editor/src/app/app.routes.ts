import type { ActivatedRouteSnapshot, Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Local sandbox',
    loadComponent: () => import('./shell/editor-page.component').then((m) => m.EditorPageComponent),
  },
  {
    path: 'r/:room',
    title: (route: ActivatedRouteSnapshot) => `Room ${route.paramMap.get('room') ?? ''}`.trim(),
    loadComponent: () => import('./shell/room-page.component').then((m) => m.RoomPageComponent),
  },
  {
    path: 'demo',
    title: 'Live demo',
    loadComponent: () => import('./demo/demo-page.component').then((m) => m.DemoPageComponent),
  },
  {
    path: 'bench',
    title: 'Pan benchmark',
    loadComponent: () => import('./shell/bench-page.component').then((m) => m.BenchPageComponent),
  },
  { path: '**', redirectTo: '' },
];
