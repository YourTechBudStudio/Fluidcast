import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5334,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4700',
    },
  },
  // Unit tests cover pure logic only; the architecture test runs on node:test.
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
