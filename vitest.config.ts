import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Edge Functions import Zod under Deno's own specifier. `supabase/functions/*/handler.ts`
    // files are plain TypeScript with their runtime dependencies injected, so Vitest can run
    // them directly — it just needs to resolve that specifier to the same package Deno gets
    // from npm. This is what lets `ingest-brief` be unit-tested rather than only deployed.
    alias: [{ find: /^npm:zod@4$/, replacement: 'zod' }],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    // `src/lib/env.ts` parses the VITE_ vars at module load and throws when they are absent — which
    // is CI, where there is no .env. Any test that imports a module that imports `env` (the auth
    // layout, the environment banner, the env predicate itself) was failing there and not locally.
    // These are the LOCAL stack's public values, so a test can never be pointed at a real project.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/types/**', 'src/test/**', 'src/**/*.test.*'],
    },
  },
})
