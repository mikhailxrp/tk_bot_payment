import { z } from 'zod';

function bigIntFromNonEmptyString(fieldName: string) {
  return z
    .string()
    .trim()
    .min(1, `${fieldName} is required`)
    .transform((value, ctx) => {
      try {
        return BigInt(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: `${fieldName} must be a valid integer` });
        return z.NEVER;
      }
    });
}

function booleanFromEnv(fieldName: string) {
  return z
    .string()
    .trim()
    .min(1, `${fieldName} is required`)
    .transform((value, ctx) => {
      const normalized = value.toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
      ctx.addIssue({
        code: 'custom',
        message: `${fieldName} must be true, false, 1, or 0`,
      });
      return z.NEVER;
    });
}

const envSchema = z.object({
  BOT_TOKEN: z.string().trim().min(1, 'BOT_TOKEN is required'),
  GROUP_ID: bigIntFromNonEmptyString('GROUP_ID'),
  COMMON_GROUP_ID: bigIntFromNonEmptyString('COMMON_GROUP_ID'),
  ADMIN_ID: bigIntFromNonEmptyString('ADMIN_ID').refine((value) => value > 0n, {
    message: 'ADMIN_ID must be a positive integer',
  }),
  ROBO_LOGIN: z.string().trim().min(1, 'ROBO_LOGIN is required'),
  ROBO_PASS1: z.string().trim().min(1, 'ROBO_PASS1 is required'),
  ROBO_PASS2: z.string().trim().min(1, 'ROBO_PASS2 is required'),
  ROBO_IS_TEST: booleanFromEnv('ROBO_IS_TEST'),
  ROBO_SNO: z.string().trim().min(1, 'ROBO_SNO is required'),
  ROBO_TAX: z.string().trim().min(1, 'ROBO_TAX is required'),
  ROBOKASSA_RESULT_URL: z.string().trim().url('ROBOKASSA_RESULT_URL must be a valid URL'),
  ROBOKASSA_SUCCESS_URL: z.string().trim().url('ROBOKASSA_SUCCESS_URL must be a valid URL'),
  ROBOKASSA_FAIL_URL: z.string().trim().url('ROBOKASSA_FAIL_URL must be a valid URL'),
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
  ADMIN_PANEL_URL: z.string().trim().min(1, 'ADMIN_PANEL_URL is required'),
  INTERNAL_API_TOKEN: z.string().trim().min(1, 'INTERNAL_API_TOKEN is required'),
  AUTH_SECRET: z.string().trim().min(1, 'AUTH_SECRET is required'),
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((value, ctx) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        ctx.addIssue({
          code: 'custom',
          message: 'PORT must be a valid TCP port (1–65535)',
        });
        return z.NEVER;
      }
      return port;
    }),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
