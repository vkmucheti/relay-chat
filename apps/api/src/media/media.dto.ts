import { id, uploadLimit, uploadTypes } from '@relay/shared';
import { z } from 'zod';
export const input = z.strictObject({
  conversationId: id,
  mimeType: z.enum(uploadTypes),
  size: z.int().positive().max(uploadLimit),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine(
      (name) =>
        [...name].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Invalid filename',
    ),
});
