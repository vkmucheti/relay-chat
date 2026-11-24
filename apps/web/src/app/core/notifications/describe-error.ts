import { HttpErrorResponse } from '@angular/common/http';
export function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
      return body.message;
    return error.status === 0
      ? 'Unable to reach the server. Check your connection.'
      : 'The request could not be completed.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
