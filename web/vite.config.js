import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api vers le serveur Express (src/server.js) en dev : le bot
// tourne en parallèle avec `npm start` (voir README, section Dashboard web).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
