import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'

/**
 * ADR-0081. The bar exists because `.env.local` is untracked, so ONE copy on disk serves every
 * branch and switching branches does not switch database. The dangerous direction is building
 * unreleased work while still pointed at production, and nothing else in the app would catch it.
 *
 * Both halves are asserted, because both carry meaning: shown on local, and **absent on production**
 * — a feature branch with no bar is how you learn you are about to create a real campaign.
 *
 * `src/lib/env` is mocked rather than driven through `import.meta.env`: the real module parses at
 * load and throws where the VITE_ vars are absent, which is CI (traps.md).
 */
async function renderWith(url: string, isLocal: boolean) {
  vi.resetModules()
  vi.doMock('../lib/env', () => ({
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' },
    isLocalEnvironment: isLocal,
    isLocalSupabase: () => isLocal,
  }))
  const { EnvironmentBanner } = await import('./EnvironmentBanner')
  render(<EnvironmentBanner />)
}

afterEach(() => vi.doUnmock('../lib/env'))

describe('EnvironmentBanner', () => {
  it('says so, and names the host, when the database is local', async () => {
    await renderWith('http://127.0.0.1:54321', true)
    expect(screen.getByTestId('environment-bar')).toHaveTextContent('LOCAL DATABASE')
    expect(screen.getByTestId('environment-bar-host')).toHaveTextContent('127.0.0.1:54321')
  })

  /** The load-bearing half: no bar means production, so a false positive would be worse than none. */
  it('renders NOTHING against a hosted project', async () => {
    await renderWith('https://abcdefgh.supabase.co', false)
    expect(screen.queryByTestId('environment-bar')).not.toBeInTheDocument()
  })

  it('cannot be dismissed — it is a standing fact, not news', async () => {
    await renderWith('http://localhost:54321', true)
    // Unlike UpdateBar, which offers "later". If a dismiss control is ever added here, this fails.
    expect(screen.getByTestId('environment-bar').querySelector('button')).toBeNull()
  })
})
