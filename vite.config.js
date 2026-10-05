import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { open: false },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
