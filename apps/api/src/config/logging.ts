import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './environment.js';

export const configureLogging = (env: Env) =>
  LoggerModule.forRoot({
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: (_req, res) => {
        const id = String(res.getHeader('x-request-id') ?? randomUUID());
        res.setHeader('x-request-id', id);
        return id;
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
        err: (err) => ({ type: err.type }),
      },
      redact: ['req.headers', 'res.headers', 'body', 'password', 'refreshToken', 'accessToken'],
      autoLogging: {
        ignore: (req) => req.url === '/metrics' || Boolean(req.url?.startsWith('/health/')),
      },
    },
  });
