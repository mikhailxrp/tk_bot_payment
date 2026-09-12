import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// This app has no .env of its own — the whole monorepo shares one `.env` at the repo root
// (see CLAUDE.md). `next` only auto-loads .env files from its own project directory, so we
// load the root one explicitly before Next reads any config/env.
loadEnvConfig(path.join(process.cwd(), '..', '..'));

const nextConfig: NextConfig = {};

export default nextConfig;
