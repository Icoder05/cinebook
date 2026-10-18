import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      BCRYPT_COST: '4',
      PAYMENT_DELAY_MS: '0',
      PAYMENT_TIMEOUT_DELAY_MS: '0',
      SWEEPER_INTERVAL_MS: '0',
      TMDB_API_KEY: '',
    },
  },
});
