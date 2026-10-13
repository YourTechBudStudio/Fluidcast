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
  // Unit tests cover the app's pure logic; the player's own tests live in its package. The architecture test runs on
  // node:test.
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
