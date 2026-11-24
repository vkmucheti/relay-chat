import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BadRequestException(
      issue ? [issue.path.join('.'), issue.message].filter(Boolean).join(': ') : 'Invalid input',
    );
  }
  return result.data;
}

export class SchemaPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return parse(this.schema, value);
  }
}
