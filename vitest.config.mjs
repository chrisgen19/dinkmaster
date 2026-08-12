import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    // Co-located unit/integration tests, plus the e2e harness's own units
    // (`e2e/*.test.js`). Playwright owns `*.spec.js` and vitest owns
    // `*.test.js`, so the two never claim the same file.
    include: ['src/**/*.test.js', 'e2e/**/*.test.js'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
