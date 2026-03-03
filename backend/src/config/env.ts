import { z } from 'zod';

const optionalUrlEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional()
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5001),
  DATABASE_URL: z.string().min(1),
  DEFAULT_CURRENCY: z.string().default('NAD'),
  AUTH_ADMIN_USERNAME: z.string().default('admin'),
  AUTH_ADMIN_PASSWORD: z.string().default('admin123'),
  AUTH_TOKEN_SECRET: z.string().min(16).default('change-this-in-production'),
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  EMAIL_FROM: z.string().default('billing@dynaverse.local'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SIMULATE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  WHATSAPP_API_URL: optionalUrlEnv,
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_DEFAULT_SENDER: z.string().optional(),
  WHATSAPP_SIMULATE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  ACADEMY_CONTACT_EMAIL: z.string().default('services@dynaverseinvestment.com'),
  ACADEMY_CONTACT_PHONE: z.string().default('+264 81 299 4529'),
  BANK_NAME: z.string().default('[Bank Name]'),
  BANK_ACCOUNT_NAME: z.string().default('Dynaverse Football Academy'),
  BANK_ACCOUNT_NUMBER: z.string().default('[XXXXXXX]')
});

export const env = EnvSchema.parse(process.env);
