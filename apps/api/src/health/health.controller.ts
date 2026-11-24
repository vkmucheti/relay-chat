import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { Connection } from 'mongoose';
import { Public } from '../auth/public.decorator.js';
import { ENV, type Env } from '../config/environment.js';
import { KafkaBus } from '../kafka/kafka.service.js';
import { MessageWorker } from '../worker/message-worker.service.js';
import { MediaService } from '../media/media.service.js';
import { RedisService } from '../redis/redis.service.js';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly checks: HealthIndicatorService,
    @InjectConnection() private readonly mongo: Connection,
    private readonly redis: RedisService,
    private readonly kafka: KafkaBus,
    private readonly media: MediaService,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly worker?: MessageWorker,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @HealthCheck()
  @Get('ready')
  ready() {
    return this.health.check([
      () =>
        this.check('mongo', async () => {
          if (!this.mongo.db) throw new Error();
          await this.mongo.db.command({ ping: 1 }, { timeoutMS: 2500 });
        }),
      () => this.check('redis', () => this.redis.client.ping()),
      () => this.check('kafka', () => this.kafka.health()),
      () => this.check('minio', () => this.media.health()),
      ...(this.env.APP_ROLE === 'worker'
        ? [
            () =>
              this.check('consumers', async () => {
                if (!this.worker?.ready) throw new Error();
              }),
          ]
        : []),
    ]);
  }
  private async check(name: string, action: () => Promise<unknown>) {
    const check = this.checks.check(name);
    try {
      await action();
      return check.up();
    } catch {
      return check.down();
    }
  }
}
