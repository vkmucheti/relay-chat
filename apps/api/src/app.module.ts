import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module.js';
import type { Env } from './config/environment.js';
import { configureLogging } from './config/logging.js';
import { DatabaseModule } from './database/database.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { HealthModule } from './health/health.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { WorkerModule } from './worker/worker.module.js';

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.register(env),
        DatabaseModule,
        configureLogging(env),
        MetricsModule,
        env.APP_ROLE === 'gateway' ? GatewayModule : WorkerModule,
        HealthModule.forRole(env.APP_ROLE),
      ],
    };
  }
}
