import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Component tests (CLAUDE.md §14): ConfirmAction and the status badges, in jsdom. Playwright e2e lives in e2e/. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    css: false,
  },
});
