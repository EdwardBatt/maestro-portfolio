/**
 * The one door's shortcut (ADR-0082 d.2): `Ctrl/Cmd + P`, from anywhere in the application.
 *
 * **Physical key, not the character.** `KeyboardEvent.code` names the key under the finger;
 * `key` names what the layout would type, which on an Arabic layout is not "p". A shortcut that
 * only works on one keyboard layout is not "from anywhere".
 *
 * **Modifier required, on purpose.** ADR-0082's context records why a bare letter was rejected:
 * correctness would depend on where focus happened to be, and the failure is silent. The modifier
 * is what makes the press deliberate. `Shift` and `Alt` are excluded so that `Ctrl+Shift+P` — the
 * browser's command palette in some builds — is left alone.
 *
 * **From a field too.** The first build left the press to any editable element, so that a modal
 * would not land over half-written work — and the review (11 Sep) found the cost: with focus in
 * a field or a `<select>` the door did not claim the key and the BROWSER's Print opened, which is
 * exactly the focus-dependence d.2 was chosen to remove. `Ctrl+P` types nothing in a field, the
 * door is a modal that Escape closes with the work still underneath, and d.3 took Print knowingly
 * — so the press is claimed everywhere, or "from anywhere" is not true.
 *
 * Pure, so it can be tested without a DOM event loop.
 */

export interface ShortcutEventLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  target?: unknown
}

/** `Ctrl+P` on Windows/Linux, `Cmd+P` on a Mac — either modifier, never both required. */
export function isNewRequestShortcut(e: ShortcutEventLike): boolean {
  if (e.code !== 'KeyP') return false
  if (!(e.ctrlKey || e.metaKey)) return false
  if (e.altKey || e.shiftKey) return false
  if (e.repeat) return false
  return true
}

/** How the shortcut is written on screen, by platform — never a hard-coded "Ctrl". */
export function shortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘ P' : 'Ctrl P'
}
