import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/dashboard/',
  build: { sourcemap: 'hidden' },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:9100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
