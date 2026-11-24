import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError } from '@relay/shared';

export function publicError(error: unknown): ApiError {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    if (status >= 500)
      return {
        code: HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR',
        message: 'Service temporarily unavailable',
      };
    const message =
      typeof response === 'string'
        ? response
        : (response as { message?: string | string[] }).message;
    return {
      code: HttpStatus[status] ?? 'ERROR',
      message: Array.isArray(message) ? (message[0] ?? error.message) : (message ?? error.message),
    };
  }
  return { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' };
}
