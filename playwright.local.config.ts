import { defineConfig, devices } from '@playwright/test'

/**
 * The LOCAL end-to-end configuration (docs/E2E-PLAN.md) — the one an independent CLI runs against
 * the seeded local stack. `playwright.config.ts` stays the deployed-URL smoke config.
 *
 *   npx playwright test -c playwright.local.config.ts            # everything
 *   npx playwright test -c playwright.local.config.ts closures   # one family
 *
 * Preconditions (the runner's job, not the tests'): `supabase start`, `supabase db reset` (the seed
 * carries every account the plan names), `supabase functions serve --env-file supabase/functions/.env`
 * with EMAIL_TRANSPORT=mailpit. The dev server is started here. Never a remote Supabase.
 *
 * Specs run in ONE worker, in file order, because they share a database: a test that declares a
 * closure or changes an owner leaves it there for the next one. Each family cleans up what it can
 * and states what it leaves. A full reset between families is `supabase db reset` — slow, and the
 * runner's call.
 */
export default defineConfig({
  testDir: './e2e/local',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI 
    ? [['github'], ['html', { open: 'never' }], ['./e2e/local/helpers/markdown-reporter.ts']] 
    : [['list'], ['html', { open: 'never' }], ['./e2e/local/helpers/markdown-reporter.ts']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Asia/Baghdad',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    // A build id the dev server would otherwise not have, so the update bar can be pressed
    // (I49.84; vite.config.ts). A dev server started by hand does not carry it, and the update-bar
    // spec says so rather than passing.
    env: { E2E_BUILD_ID: 'e2e-local' },
  },
  projects: [
    // Logs every seeded role in once and saves its storage state under e2e/.auth/ (gitignored).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
})
