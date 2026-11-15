import { z } from 'zod';
import { LIMITS } from './primitives';
import { Role } from './enums';
import { id } from './primitives';

export const LoginBody = z
  .object({
    username: z
      .string()
      .min(LIMITS.usernameMin)
      .max(LIMITS.usernameMax)
      .regex(/^[a-zA-Z0-9._-]+$/),
    // No complexity rules on login: only a size bound (hashing cost / DoS).
    password: z.string().min(1).max(LIMITS.passwordMax),
  })
  .strict();
export type LoginBody = z.infer<typeof LoginBody>;

export const Me = z.object({
  id,
  username: z.string(),
  displayName: z.string(),
  role: Role,
});
export type Me = z.infer<typeof Me>;
