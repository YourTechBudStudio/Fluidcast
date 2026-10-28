import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Isagi allocates both ports per worktree; the defaults match the backend's and keep a plain `pnpm web:dev` working.
const port = Number(process.env['FLUIDCAST_WEB_PORT'] ?? 5334);
const backendPort = Number(process.env['FLUIDCAST_PORT'] ?? 4700);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
  // Unit tests cover the app's pure logic; the player's own tests live in its package. The architecture test runs on
  // node:test.
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
