import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, timeout: 60000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:8101', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'android', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node server.mjs', url: 'http://127.0.0.1:8101/health', reuseExistingServer: false, env: { PORT: '8101', DATA_DIR: 'test-results/db', INGRESS_ONLY: 'false' } }
});
