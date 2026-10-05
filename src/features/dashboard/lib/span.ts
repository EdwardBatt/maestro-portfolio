import type { TFunction } from 'i18next'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** "26 hours" / "3 days", the same words as Needs you (requests.span). */
export function spanText(t: TFunction, since: string | null, now: number): string {
  if (!since) return '—'
  const ms = Math.max(0, now - Date.parse(since))
  if (ms < HOUR_MS) return t('requests.span.minute', { count: Math.max(1, Math.round(ms / 60000)) })
  const hours = Math.round(ms / HOUR_MS)
  if (hours < 48) return t('requests.span.hour', { count: hours })
  return t('requests.span.day', { count: Math.round(ms / DAY_MS) })
}
