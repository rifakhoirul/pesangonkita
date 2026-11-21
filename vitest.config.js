// Vitest config (PS-002): hanya jalankan unit test engine (*.test.js).
// File *.spec.js milik Playwright — jangan ikut dijalankan vitest.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
