import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://workdesk-api:4000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.API_TARGET || 'http://workdesk-api:4000',
        changeOrigin: true,
      },
    },
  },
});
