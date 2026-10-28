import { defineConfig } from 'vitest/config';

// GitHub Pages serves from /<repo>/. Override with VITE_BASE (e.g. "/" for local/root hosting).
const base = process.env.VITE_BASE ?? (process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/');

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  worker: { format: 'es' },
  test: { include: ['src/tests/**/*.test.ts'], environment: 'node' },
});
