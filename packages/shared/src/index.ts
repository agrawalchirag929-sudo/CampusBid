import { z } from 'zod';

export const USER_ROLES = ['BUYER', 'SELLER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ['active', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface AuthContext {
  userId: string;
  collegeId: string;
  roles: UserRole[];
}

export const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(320),
    password: z.string().min(10).max(128),
  })
  .strict();

export const verifyEmailSchema = z
  .object({ token: z.string().min(32).max(256) })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(128),
  })
  .strict();

export const resendVerificationSchema = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();

export const adminUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
