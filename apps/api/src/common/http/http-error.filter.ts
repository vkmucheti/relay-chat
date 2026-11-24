import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { Response } from 'express';
import { publicError } from './public-error.js';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const rawStatus =
      typeof error === 'object' && error && 'status' in error ? error.status : undefined;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : rawStatus === 413 || rawStatus === 400
          ? rawStatus
          : 500;
    const requestId = res.getHeader('x-request-id');
    let response = publicError(error);
    if (!(error instanceof HttpException)) {
      if (status === 413) response = { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' };
      if (status === 400) response = { code: 'BAD_REQUEST', message: 'Invalid JSON payload' };
      if (status >= 500)
        this.logger.error(
          { requestId, errorKind: error instanceof Error ? error.name : 'UnknownError' },
          'HTTP request failed',
        );
    }
    res.status(status).json({ ...response, requestId });
  }
}
