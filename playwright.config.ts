import { defineConfig, devices } from '@playwright/test';

const PORT = 5184;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // each test drives two WebGL canvases; more than a few at once starves them and tests time out
  workers: 4,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
});
