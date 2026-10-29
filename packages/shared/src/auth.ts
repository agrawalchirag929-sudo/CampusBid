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

export const messageResponseSchema = z
  .object({ message: z.string().min(1) })
  .strict();

export const authSessionResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().positive(),
  })
  .strict();

export const meResponseSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{24}$/i),
    email: z.string().email(),
    collegeId: z.string().regex(/^[0-9a-f]{24}$/i),
    roles: z.array(z.enum(USER_ROLES)),
    status: z.enum(USER_STATUSES),
    emailVerifiedAt: z.string().datetime({ offset: true }).nullable(),
    name: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
