import { z, type ZodType } from 'zod';
import { ApiBody, type ApiBodyOptions } from '@nestjs/swagger';

export function ApiJsonBody(schema: ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-7', unrepresentable: 'any' });
  delete json.$schema;
  return ApiBody({ schema: json as Extract<ApiBodyOptions, { schema: unknown }>['schema'] });
}
