import { COMMENCE_DAYS_BEFORE_DELIVERY, IRAQ_WORKING_CALENDAR, startFromDue, workingDaysBetween, type WorkingCalendar } from './go-live-dates'
import { iraqDay } from '../time/iraq'

/**
 * SJ-v3-04 — "Maestro counted it back for you" (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep).
 * Moved here from `features/intake/lib/lead-time.ts` (I59 Track 6, AGENTS.md §3): the reduced-scope
 * acknowledgement on My Work records the same two numbers the intake showed, so both read one rule.
 *
 * What a job NEEDS is the deliverable type's lead time (`deliverable_types.lead_time_hours`, in
 * working days of eight hours; the tenant's commence-before-delivery default when the type has
 * none or none is chosen). What it HAS is the working days between today and the due date, over
 * the CLIENT's week (ADR-0123 d.3 — Iraq's Sunday to Thursday when none is given). Short is the S2 case:
 * not a block, said out loud, carried on the job as "reduced scope".
 *
 * THE COUNT-BACK IS INCLUSIVE (Edward, 24 Sep, `I56.11`). "It needs four days" means four days of
 * work ENDING on the day it is due, so a four-day job due Thursday starts on the Monday — the same
 * rule, and now literally the same function (`startFromDue`), as the campaign timing screen.
 */
export interface LeadTime {
  needsDays: number
  hasDays: number
  /** The first working day of the window, counted back from the due date. */
  startDay: string
}

const DAY_HOURS = 8

export function computeLeadTime(
  dueDay: string,
  leadTimeHours: number | null | undefined,
  today: string = iraqDay(Date.now()),
  calendar: WorkingCalendar = IRAQ_WORKING_CALENDAR,
): LeadTime | null {
  if (!dueDay) return null
  const needsDays = leadTimeHours && leadTimeHours > 0 ? Math.max(1, Math.ceil(leadTimeHours / DAY_HOURS)) : COMMENCE_DAYS_BEFORE_DELIVERY
  const hasDays = workingDaysBetween(today, dueDay, calendar)
  const startDay = startFromDue(dueDay, needsDays, calendar)
  return { needsDays, hasDays, startDay }
}
