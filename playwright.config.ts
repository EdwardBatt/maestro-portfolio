import { defineConfig, devices } from '@playwright/test'

/**
 * E2E smoke config (L5.1). Runs against a DEPLOYED URL (preview or prod) set via
 * E2E_BASE_URL, so it exercises the real build + Supabase, not a mock. Defaults
 * to a local `vite preview` for local runs. Credentials for the authenticated
 * paths are injected via env (see e2e/smoke.spec.ts); tests self-skip when absent.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
