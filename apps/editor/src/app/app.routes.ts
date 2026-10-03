import type { Routes } from '@angular/router';

const loadEditorPage = () =>
  import('./shell/editor-page.component').then((m) => m.EditorPageComponent);

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: loadEditorPage },
  { path: 'r/:room', loadComponent: loadEditorPage },
  {
    path: 'bench',
    loadComponent: () => import('./shell/bench-page.component').then((m) => m.BenchPageComponent),
  },
  { path: '**', redirectTo: '' },
];
