import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from './auth.service';
export const requireUser: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  return auth.user() ? true : router.parseUrl('/login');
};
export const requireGuest: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  return auth.user() ? router.parseUrl('/chats') : true;
};
