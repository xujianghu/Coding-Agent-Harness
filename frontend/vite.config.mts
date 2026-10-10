import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../dist/web-ui', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4173',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        },
      },
    },
  },
});
