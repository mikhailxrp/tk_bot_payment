import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import { z } from 'zod';

// Next.js build/runtime workers each re-evaluate imported modules in their own process, so
// `next.config.ts`'s top-level `loadEnvConfig` call doesn't reliably reach every worker (e.g.
// the "collecting page data" step). Loading it here too, right before this module reads
// `process.env`, makes env loading robust regardless of which process needed it.
// `forceReload: true` is required here: `next dev` runs as a single process and already calls
// `loadEnvConfig` itself (for this app's own, nonexistent, .env files) before this module is
// ever imported — without forcing a reload, `@next/env`'s internal cache short-circuits this
// call and the root `.env` never actually gets read.
loadEnvConfig(path.join(process.cwd(), '..', '..'), process.env.NODE_ENV !== 'production', console, true);

const envSchema = z.object({
  AUTH_SECRET: z.string().trim().min(1, 'AUTH_SECRET is required'),
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment variables:\n${issues.join('\n')}`);
}

export const config = parsed.data;
export type Config = typeof config;
