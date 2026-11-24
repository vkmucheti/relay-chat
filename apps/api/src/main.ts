import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/environment.js';

import { configureHttp } from './common/http/configure-http.js';

async function main() {
  const env = loadEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  await configureHttp(app, env);
  const mongo = app.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(mongo.models).map((model) => model.init()));
  await app.listen(env.PORT, '0.0.0.0');
}
void main().catch((error: unknown) => {
  const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
  const message =
    error instanceof Error && error.message.startsWith('Invalid configuration:')
      ? error.message
      : undefined;
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      message: message ?? 'Chat service failed to start',
      errorClass,
    }) + '\n',
  );
  process.exit(1);
});
