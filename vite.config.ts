import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1600, target: 'es2022' },
  server: { port: 5173, strictPort: false }
});
