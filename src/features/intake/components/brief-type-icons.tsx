import type { ReactElement } from 'react'
import { TEMPLATE_HUES, type TemplateHue } from '../../../components/TemplateCard'

/**
 * The icon tile and hue for each brief card on SJ-v3-01 — the Figma's six colours for the six it
 * draws, a distinct hue for each of the other seeded types (Edward, 22 Sep: every card its own
 * colour), and a neutral icon with a hue by position for a template the tenant made itself
 * (templates are data, not code; a new one must still get a card). Categorical, never status.
 */
const KNOWN: Record<string, { hue: TemplateHue; icon: keyof typeof ICONS }> = {
  single_execution: { hue: 1, icon: 'execution' },
  social_calendar: { hue: 2, icon: 'social' },
  production: { hue: 3, icon: 'production' },
  influencer: { hue: 4, icon: 'people' },
  activation: { hue: 5, icon: 'activation' },
  digital_build: { hue: 6, icon: 'build' },
  '360': { hue: 7, icon: 'campaign' },
  paid_media: { hue: 8, icon: 'chart' },
  creative_strategy: { hue: 9, icon: 'idea' },
  communications_strategy: { hue: 10, icon: 'speech' },
  brand_guidelines: { hue: 11, icon: 'book' },
  custom: { hue: 12, icon: 'blank' },
}

/** The card's hue and icon for a brief type. An unknown key cycles the hues by position. */
export function briefTypeLook(briefType: string, index: number): { hue: TemplateHue; icon: ReactElement } {
  const known = KNOWN[briefType]
  const hue = known?.hue ?? (((index % TEMPLATE_HUES) + 1) as TemplateHue)
  const Icon = ICONS[known?.icon ?? 'blank']
  return { hue, icon: <Icon /> }
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ICONS = {
  execution: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <rect x="4" y="4" width="18" height="18" rx="5" />
      <path d="M9 13.5l2.5 2.5L17 10.5" />
    </svg>
  ),
  social: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <circle cx="7" cy="13" r="2.6" /><circle cx="19" cy="6.5" r="2.6" /><circle cx="19" cy="19.5" r="2.6" />
      <path d="M9.3 11.8l7.4-4.1M9.3 14.2l7.4 4.1" />
    </svg>
  ),
  production: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M4 9h5l2-3h4l2 3h5v11H4z" /><circle cx="13" cy="14.5" r="3.2" />
    </svg>
  ),
  people: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <circle cx="9.5" cy="9" r="3.4" /><circle cx="18" cy="10.5" r="2.6" />
      <path d="M3.5 21c0-3.6 2.7-6 6-6s6 2.4 6 6M16 20c.2-2.6 1.9-4.4 4.3-4.4 1.2 0 2.2.4 2.7 1" />
    </svg>
  ),
  activation: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M13 3.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L13 18.3l-5.9 3.2 1.2-6.5L3.5 10.4l6.6-.9z" />
    </svg>
  ),
  build: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3M17 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    </svg>
  ),
  campaign: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <circle cx="13" cy="13" r="9" /><circle cx="13" cy="13" r="4.5" /><path d="M13 4v3M13 19v3M4 13h3M19 13h3" />
    </svg>
  ),
  chart: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M4 21h18M7 17v-5M12 17V7M17 17v-8M22 17V11" />
    </svg>
  ),
  idea: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M9.5 19.5h7M10.5 22h5M13 3.5a6.5 6.5 0 0 0-3.8 11.8c.7.6 1.3 1.4 1.3 2.2h5c0-.8.6-1.6 1.3-2.2A6.5 6.5 0 0 0 13 3.5z" />
    </svg>
  ),
  speech: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h13A2.5 2.5 0 0 1 22 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 4.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" />
    </svg>
  ),
  book: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <path d="M5 4.5h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H5zM21 4.5h-6a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h7z" />
    </svg>
  ),
  blank: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" {...stroke}>
      <rect x="4" y="4" width="18" height="18" rx="5" /><path d="M13 9v8M9 13h8" />
    </svg>
  ),
}
