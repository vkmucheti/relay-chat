import { z } from 'zod';

const seconds = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const bool = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ROLE: z.enum(['gateway', 'worker']).default('gateway'),
    PORT: seconds(3000),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((csv) => csv.split(',').map((item) => new URL(item.trim()).origin)),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    COOKIE_SECURE: bool.default(true),
    JWT_ACCESS_SECRET: z.string().min(40),
    JWT_REFRESH_SECRET: z.string().min(40),
    ACCESS_TTL_SECONDS: seconds(900),
    REFRESH_TTL_SECONDS: seconds(604800),
    MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//),
    REDIS_URL: z.url(),
    KAFKA_BROKERS: z
      .string()
      .min(1)
      .transform((csv) => csv.split(',').map((item) => item.trim())),
    KAFKA_SSL: bool.default(false),
    KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
    KAFKA_SASL_USERNAME: z.string().min(1).optional(),
    KAFKA_SASL_PASSWORD: z.string().min(1).optional(),
    KAFKA_CLIENT_ID: z.string().min(1).default('relay'),
    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY: z.string().min(3),
    S3_SECRET_KEY: z.string().min(8),
    DELETE_WINDOW_SECONDS: seconds(3600),
    PRESENCE_TTL_SECONDS: seconds(65),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEMO_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Use distinct JWT secrets',
      });
    }
    const sasl = [env.KAFKA_SASL_MECHANISM, env.KAFKA_SASL_USERNAME, env.KAFKA_SASL_PASSWORD];
    if (sasl.some(Boolean) && (!sasl.every(Boolean) || !env.KAFKA_SSL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_SSL'],
        message: 'Kafka SASL requires TLS, mechanism, username and password',
      });
    }
    if (
      env.APP_ENV === 'production' &&
      (!env.COOKIE_SECURE ||
        !env.S3_PUBLIC_ENDPOINT.startsWith('https://') ||
        env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://')) ||
        [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET].some(
          (secret) => secret.length < 64 || secret.startsWith('local-only'),
        ))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ENV'],
        message:
          'Production requires HTTPS, secure cookies and unique JWT secrets of at least 64 characters',
      });
    }
  });
export type Env = z.infer<typeof schema>;
export const ENV = Symbol('ENV');
export function loadEnv(values: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(values);
  if (!result.success)
    throw new Error(
      'Invalid configuration: ' +
        result.error.issues.map(({ path, message }) => path.join('.') + ' ' + message).join('; '),
    );
  return result.data;
}
