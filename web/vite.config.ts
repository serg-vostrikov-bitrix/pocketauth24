import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist' },
  // `npm run dev --prefix web` reads the API of a local `npm run dev` server.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
