import { id } from '@relay/shared';
import { z } from 'zod';
const name = z.string().trim().min(1).max(72);
const avatarKey = z
  .url()
  .max(512)
  .refine((value) => new URL(value).protocol === 'https:');
const users = z
  .array(id)
  .min(1)
  .max(49)
  .transform((ids) => [...new Set(ids)]);
export const directInput = z.strictObject({ userId: id });
export const groupInput = z.strictObject({ name, userIds: users, avatarKey: avatarKey.optional() });
export const updateInput = z
  .strictObject({ name: name.optional(), avatarKey: avatarKey.nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Provide a name or avatar');
export const membersInput = z.strictObject({ userIds: users });
export const pageInput = z.strictObject({
  cursor: z.string().max(110).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const cursorSchema = z.object({ at: z.iso.datetime(), id });
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');
