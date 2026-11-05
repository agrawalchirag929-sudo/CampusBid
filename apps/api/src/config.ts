import { z } from 'zod';

const trustProxySchema = z
  .union([
    z.literal('true').transform(() => true),
    z.literal('false').transform(() => false),
    z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value)),
  ])
  .default(false);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    MONGO_URI: z.string().min(1).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    JWT_SECRET: z.string().min(32),
    MAIL_OUTBOX_KEY: z.string().min(32),
    COOKIE_NAME: z.string().trim().min(1),
    COOKIE_DOMAIN: z.string().trim().min(1).optional(),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .refine(
        (origins) =>
          origins.length > 0 &&
          origins.every((origin) => {
            try {
              const parsed = new URL(origin);
              return (
                parsed.protocol === 'http:' || parsed.protocol === 'https:'
              );
            } catch {
              return false;
            }
          }),
        'CORS_ORIGINS must be a comma-separated list of HTTP(S) origins',
      ),
    TRUST_PROXY: trustProxySchema,
    CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z.string().trim().min(1).optional(),
    RUN_WORKER: z
      .union([
        z.literal('true').transform(() => true),
        z.literal('false').transform(() => false),
      ])
      .default(false),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV !== 'production') return;
    for (const key of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
    ] as const) {
      if (config[key] === undefined || config[key] === '') {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) =>
      issue.path.join('.'),
    );
    throw new Error(
      `Invalid API environment configuration: ${invalidFields.join(', ')}`,
    );
  }
  return parsed.data;
}
