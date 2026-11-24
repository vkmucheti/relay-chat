import { logLevel, type KafkaConfig } from 'kafkajs';
import { type Env } from '../config/environment.js';

export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';
export function connection(env: Env): KafkaConfig {
  return {
    brokers: env.KAFKA_BROKERS,
    clientId: env.KAFKA_CLIENT_ID,
    connectionTimeout: 3000,
    requestTimeout: 45000,
    ssl: env.KAFKA_SSL,
    sasl:
      env.KAFKA_SASL_MECHANISM && env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD
        ? ({
            mechanism: env.KAFKA_SASL_MECHANISM,
            username: env.KAFKA_SASL_USERNAME,
            password: env.KAFKA_SASL_PASSWORD,
          } as KafkaConfig['sasl'])
        : undefined,
    logLevel: logLevel.NOTHING,
    retry: { retries: 3, initialRetryTime: 250, maxRetryTime: 1200 },
  };
}
