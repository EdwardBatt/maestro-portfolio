import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHIME_STORAGE_KEY,
  CHIME_TYPES,
  chimeForNotification,
  chimesFor,
  installChimePrimer,
  isChimeOn,
  isChimePrimed,
  primeChime,
  resetChimeForTests,
  setChimeOn,
} from './chime'

/** A Web Audio stand-in that records what was scheduled. */
function fakeAudio() {
  const started: number[] = []
  class FakeCtx {
    state = 'running'
    currentTime = 0
    destination = {}
    resume = vi.fn()
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: (at: number) => started.push(at),
        stop: vi.fn(),
      }
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
    }
  }
  vi.stubGlobal('AudioContext', FakeCtx)
  return started
}

describe('the chime (ADR-0113 d.4, Q19)', () => {
  beforeEach(() => {
    resetChimeForTests()
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('chimes for exactly the fifteen types that ask for action', () => {
    expect([...CHIME_TYPES].sort()).toEqual(
      [
        'assigned', 'review_requested', 'changes_requested', 'assignment_requested', 'extension_requested',
        'extension_forwarded', 'change_request_sent', 'change_request_answered', 'question_asked', 'nudged',
        'too_much', 'escalated', 'review_reminder', 'over_capacity', 'task_blocked',
      ].sort(),
    )
  })

  it('stays silent for information-only types and for anything that is not a type', () => {
    for (const type of ['signed_off', 'due_soon', 'campaign_approved', 'question_replied', 'untimed_round', 'extension_approved', 'chat_added']) {
      expect(chimesFor(type)).toBe(false)
    }
    expect(chimesFor(undefined)).toBe(false)
    expect(chimesFor(42)).toBe(false)
  })

  it('the switch is ON by default and remembers OFF on this device', () => {
    expect(isChimeOn()).toBe(true)
    setChimeOn(false)
    expect(localStorage.getItem(CHIME_STORAGE_KEY)).toBe('off')
    expect(isChimeOn()).toBe(false)
    setChimeOn(true)
    expect(isChimeOn()).toBe(true)
  })

  it('a storage that throws keeps the default rather than breaking the page', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isChimeOn()).toBe(true)
    spy.mockRestore()
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setChimeOn(false)).not.toThrow()
    set.mockRestore()
  })

  it('plays nothing before the page has been interacted with', () => {
    const started = fakeAudio()
    expect(isChimePrimed()).toBe(false)
    expect(chimeForNotification('assigned')).toBe(false)
    expect(started).toHaveLength(0)
  })

  it('after the first click it plays two notes for an action type, none for an information type', () => {
    const started = fakeAudio()
    installChimePrimer()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(isChimePrimed()).toBe(true)
    expect(chimeForNotification('signed_off')).toBe(false)
    expect(started).toHaveLength(0)
    expect(chimeForNotification('review_requested')).toBe(true)
    expect(started).toHaveLength(2)
  })

  it('the switch off silences even an action type', () => {
    const started = fakeAudio()
    primeChime()
    setChimeOn(false)
    expect(chimeForNotification('escalated')).toBe(false)
    expect(started).toHaveLength(0)
  })
})
