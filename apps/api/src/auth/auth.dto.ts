import { z } from 'zod';
const password = z.string().min(12).max(128);
export const loginSchema = z.strictObject({
  login: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});
export const registerSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/),
  email: z.email().max(254).toLowerCase(),
  displayName: z.string().trim().min(1).max(60),
  password,
});
