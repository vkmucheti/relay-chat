import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly sockets = new Gauge({
    name: 'relay_connected_sockets',
    help: 'Socket.IO connections on this gateway',
    registers: [this.registry],
  });
  readonly messages = new Counter({
    name: 'relay_messages_total',
    help: 'Message pipeline operations',
    labelNames: ['stage'],
    registers: [this.registry],
  });
  readonly dlq = new Counter({
    name: 'relay_kafka_dlq_total',
    help: 'Records written to the dead-letter topic',
    labelNames: ['topic'],
    registers: [this.registry],
  });
  readonly lag = new Gauge({
    name: 'relay_kafka_consumer_lag',
    help: 'Broker offset minus committed group offset',
    labelNames: ['group', 'topic', 'partition'],
    registers: [this.registry],
  });
  readonly latency = new Histogram({
    name: 'relay_http_request_duration_seconds',
    help: 'HTTP duration by route',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
