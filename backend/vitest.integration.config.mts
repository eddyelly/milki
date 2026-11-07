import { defineConfig } from 'vitest/config';

/** Integration tests against the live Fabric network + infra. Uses backend/.env (run `npm run seed` first). */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { LOG_LEVEL: 'warn', NODE_ENV: 'development' },
  },
});
