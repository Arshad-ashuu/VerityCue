import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Shared .env lives at the repo root.
  envDir: '..',
  server: {
    port: 5173,
    // Required so a dev tunnel host can proxy to this server.
    host: true,
    allowedHosts: true,
    // Keeps the API same-origin so only one port needs tunnelling into Teams, and the
    // HTTPS panel never makes a blocked http://localhost call.
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:3978',
        changeOrigin: true,
      },
    },
  },
});
