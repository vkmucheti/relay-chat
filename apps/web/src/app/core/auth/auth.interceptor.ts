import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

import { AuthService } from './auth.service';
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.api + '/') || req.url.startsWith(environment.api + '/auth/'))
    return next(req);
  const auth = inject(AuthService);
  const token = auth.token();
  const signed = (value: string | null) =>
    value ? req.clone({ setHeaders: { Authorization: 'Bearer ' + value } }) : req;
  return next(signed(token)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token)
        return throwError(() => error);
      const latest = auth.token();
      if (latest && latest !== token) return next(signed(latest));
      return from(auth.refresh()).pipe(
        switchMap((session) =>
          session ? next(signed(session.accessToken)) : throwError(() => error),
        ),
      );
    }),
  );
};
