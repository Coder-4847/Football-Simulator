import { defineConfig } from '@playwright/test';

// Set PW_CHROMIUM to a Chromium binary if `npx playwright install` is not available.
export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1024, height: 600 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
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
