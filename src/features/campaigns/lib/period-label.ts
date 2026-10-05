import type { TFunction } from 'i18next'
import { formatPlanRange } from '../../../lib/timing/plan-back'
import { NO_DATE, type MapColumn } from './season-map'

/**
 * How a period is named in a filter (I63, Edward 28 Sep): a phase as "2. Week 1", a week as "Week 3 ·
 * 20–26 Sept", then "No date" / "No phase". The season map's column heads say the same things.
 */
export function periodLabel(col: MapColumn, t: TFunction, language: string): string {
  if (col.phase) return `${col.phase.number}. ${col.phase.name}`
  if (col.week) return `${t('campaigns.seasonMap.week', { number: col.week.number })} · ${formatPlanRange(col.week.startsOn, col.week.endsOn, language)}`
  return t(col.key === NO_DATE ? 'campaigns.seasonMap.noDate' : 'campaigns.seasonMap.noPhase')
}
