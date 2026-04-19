import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/dashboard/',
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router-dom/')) {
            return 'router-vendor';
          }
          if (id.includes('node_modules/@xterm/')) {
            return 'terminal-vendor';
          }
          if (id.includes('node_modules/dompurify/') || id.includes('node_modules/zod/')) {
            return 'utils-vendor';
          }
          if (id.includes('node_modules/@tanstack/react-virtual/')) {
            return 'virtual-vendor';
          }
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5200,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:19200',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
