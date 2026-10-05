import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../lib/i18n'
import { shouldPromptReload } from '../lib/version'

/**
 * A tab that has been open all week should be told, once, that it is out of date (6 Sep).
 *
 * Edward: *"users are not logging out of the site in some cases and as we are continuously updating
 * the site, they are not always using the latest version."* Maestro is one bundle with no code
 * splitting, so an open tab never fetches anything again and cannot discover a release by accident.
 *
 * The decision itself is `shouldPromptReload`, tested first and separately, because every wrong
 * answer is user-visible and awkward to catch by hand: nagging somebody already current, or staying
 * silent through a deploy.
 */
describe('shouldPromptReload', () => {
  it('prompts only on a definite mismatch', () => {
    expect(shouldPromptReload('abc123', 'def456')).toBe(true)
    expect(shouldPromptReload('abc123', 'abc123')).toBe(false)
  })

  // A failed or odd check is not evidence of a new version — offline, a captive portal, a deploy
  // mid-flight. A bar that appears when the network hiccups is one people learn to close unread.
  it('says nothing when the answer is missing, empty or not a string', () => {
    expect(shouldPromptReload('abc123', undefined)).toBe(false)
    expect(shouldPromptReload('abc123', null)).toBe(false)
    expect(shouldPromptReload('abc123', '')).toBe(false)
    expect(shouldPromptReload('abc123', '   ')).toBe(false)
    expect(shouldPromptReload('abc123', 42)).toBe(false)
    expect(shouldPromptReload('abc123', { buildId: 'def456' })).toBe(false)
  })

  // The dev server rebuilds constantly and hot-reloads anyway. A bar on every save would train
  // everyone to ignore the one that matters in production.
  it('never prompts in development, in either direction', () => {
    expect(shouldPromptReload('dev', 'abc123')).toBe(false)
    expect(shouldPromptReload('abc123', 'dev')).toBe(false)
  })
})

/**
 * The bar itself. `BUILD_ID` is `'dev'` under vitest — `__BUILD_ID__` is defined only by the real
 * build — so the module is mocked to a fixed id; without that the hook correctly does nothing and
 * every assertion below would be vacuous.
 */
vi.mock('../lib/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/version')>()),
  BUILD_ID: 'build-one',
}))

import { UpdateBar } from './UpdateBar'

const fetchMock = vi.fn()

describe('UpdateBar', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const served = (buildId: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ buildId }) })

  it('says nothing while the tab is running the current build', async () => {
    served('build-one')
    render(<UpdateBar />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  it('offers a reload once a newer build is being served', async () => {
    served('build-two')
    render(<UpdateBar />)
    expect(await screen.findByTestId('update-bar')).toHaveTextContent(/new version of Maestro/i)
    expect(screen.getByTestId('update-bar-reload')).toBeInTheDocument()
  })

  // NON-BLOCKING: somebody is always half-way through a brief, and a page that reloads under a
  // person is worse than the staleness it fixes.
  it('never reloads on its own — the reload is a button', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload }, writable: true, configurable: true,
    })
    served('build-two')
    render(<UpdateBar />)
    await screen.findByTestId('update-bar')
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('update-bar-reload'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed and stays gone', async () => {
    served('build-two')
    render(<UpdateBar />)
    fireEvent.click(await screen.findByTestId('update-bar-dismiss'))
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  // Offline, a proxy serving HTML, a deploy mid-flight: none of those mean a new version exists.
  it('stays silent when the check fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<UpdateBar />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  it('stays silent on a non-OK response rather than treating it as a new build', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ buildId: 'build-two' }) })
    render(<UpdateBar />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  // The request has to bypass whatever cached the last answer, or the check can never see past the
  // build it was loaded with — which is the entire failure being fixed.
  it('asks the network, not the cache', async () => {
    served('build-one')
    render(<UpdateBar />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })
})
