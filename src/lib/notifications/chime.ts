/**
 * ADR-0113 d.4 (I59.28, Q19) — a short, soft chime when a notification that ASKS FOR ACTION arrives.
 * Information-only notifications stay silent.
 *
 * The tone is made with the Web Audio API — no audio file, no dependency. Browsers refuse to start
 * sound until the person has interacted with the page, so the AudioContext is created (primed) on
 * the first click or key press and the chime is silently skipped before that.
 *
 * The switch is per person, per device: `localStorage`, ON by default. Every read and write is
 * wrapped — a private window or blocked storage simply keeps the default.
 */

/** The notification types that ask the reader to do something (Q19). */
export const CHIME_TYPES: ReadonlySet<string> = new Set([
  'assigned',
  'review_requested',
  'changes_requested',
  'assignment_requested',
  'extension_requested',
  'extension_forwarded',
  'change_request_sent',
  'change_request_answered',
  'question_asked',
  'nudged',
  'too_much',
  'escalated',
  'review_reminder',
  'over_capacity',
  'task_blocked',
])

export function chimesFor(type: unknown): boolean {
  return typeof type === 'string' && CHIME_TYPES.has(type)
}

export const CHIME_STORAGE_KEY = 'maestro.notificationChime'

/** On unless the person turned it off on this device. */
export function isChimeOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHIME_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setChimeOn(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(CHIME_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* storage blocked — the switch still reflects the choice for this page's life */
  }
}

type AudioContextCtor = new () => AudioContext

let ctx: AudioContext | null = null

function audioContextCtor(): AudioContextCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Create (or resume) the AudioContext. Call from inside a user gesture. */
export function primeChime(): void {
  try {
    if (!ctx) {
      const Ctor = audioContextCtor()
      if (!Ctor) return
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}

/** True once the page has had the gesture a browser needs before it will play sound. */
export function isChimePrimed(): boolean {
  return ctx !== null
}

let primerInstalled = false

/** Prime on the first click or key press anywhere on the page. Idempotent. */
export function installChimePrimer(): void {
  if (primerInstalled || typeof document === 'undefined') return
  primerInstalled = true
  const onFirst = () => {
    primeChime()
    document.removeEventListener('pointerdown', onFirst, true)
    document.removeEventListener('keydown', onFirst, true)
  }
  document.addEventListener('pointerdown', onFirst, true)
  document.addEventListener('keydown', onFirst, true)
}

/**
 * Two soft sine notes, a fifth apart, ~0.45 s in all, at low volume. Does nothing before the page
 * has been primed, or when the switch is off.
 */
export function playChime(): void {
  if (!ctx || !isChimeOn()) return
  try {
    const now = ctx.currentTime
    const notes: [number, number][] = [
      [880, 0],
      [1318.5, 0.14],
    ]
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(0.08, now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + at)
      osc.stop(now + at + 0.32)
    }
  } catch {
    /* no audio pipeline — a chime is a courtesy, never an error */
  }
}

/** A new notification arrived on the live channel: chime if its type asks for action. */
export function chimeForNotification(type: unknown): boolean {
  if (!chimesFor(type) || !isChimeOn() || !ctx) return false
  playChime()
  return true
}

/** Test seam: forget the primed context and the installed primer. */
export function resetChimeForTests(): void {
  ctx = null
  primerInstalled = false
}
