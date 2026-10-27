import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173/',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM ?? undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'VITE_BASE=/ npm run build && VITE_BASE=/ npx vite preview --port 4173',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
