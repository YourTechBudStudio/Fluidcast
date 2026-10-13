import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic and the player over fake media; `tests/` adds the provider-free integration test across
// the Harness, Client and player. The architecture, style and scoping tests run on node:test.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
