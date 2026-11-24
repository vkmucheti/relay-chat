import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookies from 'cookie-parser';
import { HttpErrorFilter } from './http-error.filter.js';
import { type Env } from '../../config/environment.js';
import { MetricsService } from '../../metrics/metrics.service.js';

export async function configureHttp(app: NestExpressApplication, env: Env) {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.set('trust proxy', env.TRUST_PROXY || false);
  app.use(
    helmet({
      contentSecurityPolicy: env.APP_ENV === 'production',
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression());
  app.enableCors({
    credentials: true,
    origin: (origin, callback) =>
      callback(null, Boolean(!origin || env.CORS_ORIGINS.includes(origin))),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['x-request-id'],
  });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-request-id', randomUUID());
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookies());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpErrorFilter(await app.resolve(PinoLogger)));
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/{*path}', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  const metrics = app.get(MetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      metrics.latency.observe(
        { method: req.method, route, status: String(res.statusCode) },
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    });
    next();
  });
  if (env.APP_ROLE === 'worker') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/health/') || req.path === '/metrics') next();
      else res.sendStatus(404);
    });
  } else {
    const document = new DocumentBuilder()
      .setTitle('Relay Chat API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, document), {
      customSiteTitle: 'Relay API',
    });
  }
}
