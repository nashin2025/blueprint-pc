import { defineConfig, devices } from '@playwright/test'

/**
 * E2E test configuration for Blueprint PC.
 *
 * Tests connect to the Electron app running in dev mode (localhost:5173).
 * Start the app with:  ELECTRON_RUN_AS_NODE=1 npm run dev
 * Then run tests with:  npm run test:e2e
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx electron-vite dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
