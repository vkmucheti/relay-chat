import { id } from '@relay/shared';
import { z } from 'zod';
export const input = z.strictObject({
  userId: id,
  alias: z.string().trim().min(1).max(60).optional(),
});
