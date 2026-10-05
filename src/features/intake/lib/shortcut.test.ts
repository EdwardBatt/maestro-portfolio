import { describe, expect, it } from 'vitest'
import { isNewRequestShortcut, shortcutLabel } from './shortcut'

const press = (over: Partial<Parameters<typeof isNewRequestShortcut>[0]>) => ({
  code: 'KeyP',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  target: { tagName: 'BODY' },
  ...over,
})

/**
 * ADR-0082 d.2: `Ctrl/Cmd + P` opens the one door. The rule is pure so that every wrong answer —
 * a shortcut that fires on a bare letter, or on one layout only, or over a field somebody is
 * typing in — is a one-line assertion rather than a bug report.
 */
describe('isNewRequestShortcut (ADR-0082)', () => {
  it('fires on Ctrl+P and on Cmd+P', () => {
    expect(isNewRequestShortcut(press({ ctrlKey: true }))).toBe(true)
    expect(isNewRequestShortcut(press({ metaKey: true }))).toBe(true)
  })

  // The bare letter was rejected on use (Edward, 10 Sep): correctness would depend on focus.
  it('never fires on a bare P', () => {
    expect(isNewRequestShortcut(press({}))).toBe(false)
  })

  // Physical key: an Arabic layout types a different character on the same key.
  it('reads the physical key, so the layout does not matter', () => {
    expect(isNewRequestShortcut(press({ ctrlKey: true, code: 'KeyN' }))).toBe(false)
    expect(isNewRequestShortcut(press({ ctrlKey: true, code: 'KeyP' }))).toBe(true)
  })

  it('leaves Ctrl+Shift+P and Ctrl+Alt+P to the browser', () => {
    expect(isNewRequestShortcut(press({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isNewRequestShortcut(press({ ctrlKey: true, altKey: true }))).toBe(false)
  })

  // "From anywhere" (d.2) includes a field: leaving the press to an editable element handed the
  // key back to the browser's Print whenever focus sat in one (review, 11 Sep).
  it('fires from inside a field too — the door claims the key everywhere', () => {
    expect(isNewRequestShortcut(press({ ctrlKey: true, target: { tagName: 'INPUT' } }))).toBe(true)
    expect(isNewRequestShortcut(press({ ctrlKey: true, target: { tagName: 'SELECT' } }))).toBe(true)
    expect(isNewRequestShortcut(press({ ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } }))).toBe(true)
  })

  // A held key repeats the event; one press is one door.
  it('ignores auto-repeat', () => {
    expect(isNewRequestShortcut(press({ ctrlKey: true, repeat: true }))).toBe(false)
  })
})

describe('shortcutLabel', () => {
  it('names the key by platform', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘ P')
    expect(shortcutLabel('Win32')).toBe('Ctrl P')
  })
})
