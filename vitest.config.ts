import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

export default defineConfig({
  test: {
    include: [`${rootDir}/apps/bot/test/**/*.test.ts`],
    setupFiles: [`${rootDir}/apps/bot/test/setup.ts`],
  },
});
