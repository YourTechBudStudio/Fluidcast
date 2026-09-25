import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
});
