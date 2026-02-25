//
// Vitest config for unit-testing pure renderer modules (merge logic, save
// controller, etc.) without needing Electron or CodeMirror in the test runner.
//
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
