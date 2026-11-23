import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The preview host is dynamic, so accept it explicitly, and forward API calls to the
    // backend so the browser only ever talks to one origin.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.SV_API_URL ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
