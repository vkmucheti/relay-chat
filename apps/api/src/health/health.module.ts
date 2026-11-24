import { Module, type DynamicModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import type { Env } from '../config/environment.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { MediaModule } from '../media/media.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { WorkerModule } from '../worker/worker.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule, MediaModule, KafkaModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {
  static forRole(role: Env['APP_ROLE']): DynamicModule {
    return { module: HealthModule, imports: role === 'worker' ? [WorkerModule] : [] };
  }
}
