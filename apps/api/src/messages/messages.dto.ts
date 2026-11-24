import { id, receiptInput } from '@relay/shared';
import { z } from 'zod';
export const pageInput = z
  .strictObject({
    before: id.optional(),
    after: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(35),
  })
  .refine(({ before, after }) => !(before && after), 'Use either before or after');
export const scope = z.enum(['me', 'everyone']).default('me');
export const readInput = receiptInput.pick({ messageId: true });
