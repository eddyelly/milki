import { defineConfig } from 'vitest/config';

/**
 * Unit/API tests: real MongoDB + Redis from infra/ (separate `milki_test` DB and Redis DB 1),
 * Fabric and SMS mocked in test/setup.ts. Run `docker compose -f ../infra/docker-compose.yml up -d` first.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGO_URI: 'mongodb://milki:milki_dev@localhost:27117/milki_test?authSource=admin',
      REDIS_URL: 'redis://:milki_dev@localhost:6390/1',
      MINIO_ACCESS_KEY: 'milki',
      MINIO_SECRET_KEY: 'milki_dev_secret',
      JWT_ACCESS_SECRET: 'test_access_secret_0123456789abcdef',
      JWT_REFRESH_SECRET: 'test_refresh_secret_0123456789abcdef',
      WALLET_ENCRYPTION_KEY: '6d696c6b692d746573742d6b65792d30313233343536373839616263646566ff',
      PII_HASH_SALT: 'test_salt_value',
      FABRIC_ENABLED: 'true',
      AUTH_RATE_LIMIT_PER_MIN: '1000',
    },
  },
});
