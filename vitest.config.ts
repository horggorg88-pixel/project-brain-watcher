import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'apps/**/tests/e2e/**',
      'node_modules/**',
      'dist/**',
      'release/**',
    ],
  },
});
