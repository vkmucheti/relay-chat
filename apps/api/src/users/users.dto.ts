import { z } from 'zod';
export const profileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60).optional(),
  avatarKey: z
    .string()
    .url()
    .max(512)
    .refine((value) => new URL(value).protocol === 'https:')
    .optional(),
  about: z.string().trim().max(160).optional(),
});
export const searchSchema = z.string().trim().min(1).max(60);
