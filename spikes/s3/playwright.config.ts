import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 600_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5183', browserName: 'chromium' },
  webServer: { command: 'npx vite --port 5183 --strictPort', url: 'http://localhost:5183', reuseExistingServer: true, timeout: 60_000 },
});
