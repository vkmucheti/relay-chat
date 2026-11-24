import type { Routes } from '@angular/router';
import { requireGuest, requireUser } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [requireGuest],
    data: { register: false },
    loadComponent: () => import('./auth/auth-page').then((module) => module.AuthPage),
  },
  {
    path: 'register',
    canActivate: [requireGuest],
    data: { register: true },
    loadComponent: () => import('./auth/auth-page').then((module) => module.AuthPage),
  },
  {
    path: '',
    canActivate: [requireUser],
    loadComponent: () =>
      import('./authenticated/authenticated-layout').then((module) => module.AuthenticatedLayout),
    children: [
      {
        path: 'chats',
        loadChildren: () => import('./chat/chat.routes').then((module) => module.chatRoutes),
      },
      {
        path: 'profile',
        loadComponent: () => import('./profile/profile').then((module) => module.Profile),
      },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'chats' },
  { path: '**', redirectTo: 'chats' },
];
