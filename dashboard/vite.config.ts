import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'open-dyslexic': path.resolve(__dirname, 'node_modules/open-dyslexic'),
    },
  },
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
          if (id.includes('node_modules/dompurify/') || id.includes('node_modules/zod/')) {
            return 'utils-vendor';
          }
          if (id.includes('node_modules/@tanstack/react-virtual/')) {
            return 'virtual-vendor';
          }
          // recharts, d3, and @xterm are intentionally NOT pinned to manual chunks.
          // Vite naturally code-splits them into the lazy-loaded page chunks that
          // use them (AnalyticsPage, CostPage, MetricsPage, SessionDetailPage),
          // saving ~181 KB gzip from the initial bundle (issue #2646).
          // lucide-react icons
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons-vendor';
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
      '/auth': {
        target: 'http://127.0.0.1:19200',
        changeOrigin: true,
      },
    },
  },
});
