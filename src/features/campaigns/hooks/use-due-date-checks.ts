import { useCallback } from 'react'
import { classifyDueDate, workingDaysBetween, type DueDateArithmetic } from '../../../lib/campaigns/go-live-dates'
import { useClientCalendar } from '../../../lib/calendar/client-calendar'
import { DEFAULT_SCHEDULING_SETTINGS, useSchedulingSettings } from '../../../lib/settings/scheduling-settings-api'
import { iraqDay } from '../../../lib/time/iraq'
import { phaseDueDate } from '../../../lib/timing/plan-back'
import { useOutstandingHours, useRecordDueDateOverride } from '../../deliverables/api/extensions-api'

/**
 * **The two checks on a deliverable's due date**, shared by every place that changes one — the evidenced date dialog,
 * Edit piece and the piece's panel (ADR-0132; I68.11, I68.12). Written once so the three cannot drift:
 *
 *  - `phaseDue(endsOn)` — I57.36: moving a piece to a phase moves its date to that phase's delivery day, planned back
 *    with the rule and the client's calendar the timing step uses (`phaseDueDate`);
 *  - `arithmetic(day)` — ADR-0075 d.9 / ADR-0093: the working days the date leaves before go-live against the tenant's
 *    rule, and the open hours against the working days to it (tight / impossible / after go-live);
 *  - `recordIfWarned(day, arithmetic)` — a warning someone proceeded past is recorded (`due_date_override`), never a
 *    silent click.
 */
/** I57.36 alone: a phase's delivery day, planned back on the client's calendar with the tenant's rule. */
export function usePhaseDue(clientId: string) {
  const { calendar } = useClientCalendar(clientId)
  const settings = useSchedulingSettings()
  const rule = (settings.data ?? DEFAULT_SCHEDULING_SETTINGS).rule
  const phaseDue = useCallback((endsOn: string) => phaseDueDate({ endsOn }, calendar, rule), [calendar, rule])
  return { phaseDue, calendar, rule }
}

export function useDueDateChecks(opts: { deliverableId: string; clientId: string; goLiveAt: string | null }) {
  const { phaseDue, calendar, rule } = usePhaseDue(opts.clientId)
  const outstanding = useOutstandingHours(opts.deliverableId)
  const recordOverride = useRecordDueDateOverride()
  const goLiveDay = opts.goLiveAt ? iraqDay(opts.goLiveAt) : null

  const arithmetic = useCallback(
    (day: string): DueDateArithmetic | null => {
      if (!day) return null
      const today = iraqDay(new Date().toISOString())
      return classifyDueDate({
        dueDay: day,
        goLiveDay,
        calendar,
        rule,
        outstandingHours: outstanding.data ?? null,
        workingDaysToDue: outstanding.data != null ? workingDaysBetween(today < day ? today : day, day, calendar) : null,
      })
    },
    [goLiveDay, calendar, rule, outstanding.data],
  )

  const recordIfWarned = useCallback(
    async (day: string, a: DueDateArithmetic | null) => {
      if (!a || !goLiveDay) return
      if (a.severity !== 'tight' && a.severity !== 'impossible' && a.severity !== 'after_go_live') return
      await recordOverride.mutateAsync({
        deliverableId: opts.deliverableId,
        dueDay: day,
        severity: a.severity,
        goLiveDay,
        workingDaysLeft: a.workingDaysToGoLive,
        requiredDays: a.requiredDays,
        outstandingHours: a.outstandingHours,
        capacityHours: a.capacityHours,
      })
    },
    [goLiveDay, opts.deliverableId, recordOverride],
  )

  return { phaseDue, arithmetic, recordIfWarned }
}
