import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { Partitioners } from 'kafkajs';
import { ENV, type Env } from '../config/environment.js';
import { MetricsModule } from '../metrics/metrics.module.js';

import { KAFKA_PRODUCER, connection } from './kafka.options.js';
import { KafkaBus } from './kafka.service.js';
@Module({
  imports: [
    MetricsModule,
    ClientsModule.registerAsync([
      {
        name: KAFKA_PRODUCER,
        inject: [ENV],
        useFactory: (env: Env) => ({
          transport: Transport.KAFKA,
          options: {
            client: connection(env),
            producerOnlyMode: true,
            producer: {
              idempotent: true,
              allowAutoTopicCreation: false,
              maxInFlightRequests: 1,
              createPartitioner: Partitioners.DefaultPartitioner,
            },
            send: { acks: -1, timeout: 6000 },
          },
        }),
      },
    ]),
  ],
  providers: [KafkaBus],
  exports: [KafkaBus],
})
export class KafkaModule {}
