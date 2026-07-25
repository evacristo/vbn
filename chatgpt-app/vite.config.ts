import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/widget',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
