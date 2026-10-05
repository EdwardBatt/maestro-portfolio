import { describe, expect, it } from 'vitest'
import { LIVE_REFRESH, liveOptions } from './live'

describe('live refresh (ADR-0105 d.5) — the Schedule and the team view', () => {
  it('refreshes every 20 seconds and on returning to the tab', () => {
    expect(liveOptions(true)).toEqual({ refetchInterval: 20_000, refetchOnWindowFocus: true })
    expect(LIVE_REFRESH.refetchInterval).toBe(20_000)
  })
  it('leaves every other reader on the app defaults', () => {
    expect(liveOptions(false)).toEqual({})
    expect(liveOptions(undefined)).toEqual({})
  })
})
