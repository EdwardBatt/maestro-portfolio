import type { TFunction } from 'i18next'

/**
 * "1 file" / "12 files" without i18next plurals, which the EN/AR parity test cannot hold (traps.md):
 * every counted line has a plain key and a `…One` twin in both languages, and this picks one.
 */
export function countText(t: TFunction, key: string, n: number, extra: Record<string, unknown> = {}): string {
  return n === 1 ? t(`${key}One`, { n, ...extra }) : t(key, { n, ...extra })
}
