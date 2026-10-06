import type { ActivatedRouteSnapshot, Route, Routes } from '@angular/router';
import { START_PAGE } from './start-page';

const SANDBOX_TITLE = 'Local sandbox';

const loadEditorPage = () =>
  import('./shell/editor-page.component').then((m) => m.EditorPageComponent);

const homePath = START_PAGE === 'demo' ? 'demo' : '';

const startRoute: Route =
  START_PAGE === 'demo'
    ? { path: '', pathMatch: 'full', redirectTo: homePath }
    : { path: '', pathMatch: 'full', title: SANDBOX_TITLE, loadComponent: loadEditorPage };

export const routes: Routes = [
  startRoute,
  { path: 'solo', title: SANDBOX_TITLE, loadComponent: loadEditorPage },
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
  { path: '**', redirectTo: homePath },
];
