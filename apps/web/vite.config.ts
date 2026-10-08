import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5334,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4700',
    },
  },
  // Unit tests cover pure logic and the player over fake media; `tests/` adds the provider-free integration test across
  // the Harness, Client and player. The architecture test runs on node:test.
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
