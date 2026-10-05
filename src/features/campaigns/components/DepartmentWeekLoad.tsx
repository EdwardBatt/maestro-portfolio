import { useTranslation } from 'react-i18next'
import { capacityLevel, useTeamLoad } from '../../team/api/team-api'

/**
 * The capacity column on the timing step (`CB-v3-04`, `I56.11` Q14): the DEPARTMENT's load for the
 * week a piece is due — *"Creative at 31% — fine"*. Never a person: who does the work is decided
 * after approval, by the owner, and a name here would read as a booking nobody made.
 *
 * The same reading the single job's owner line makes (`WhoAndWhenStep`'s `LeadRow`): the week's
 * booked hours over the nominal hours of everybody in the department, through `capacityLevel`. One
 * rule for "busy", on both screens. The read is cached per week by `useTeamLoad`, so ten pieces due
 * in the same week cost one read, not ten.
 */
export function DepartmentWeekLoad({
  departmentId,
  departmentName,
  dueOn,
  testId,
}: {
  departmentId: string | null
  departmentName: string | null
  /** `YYYY-MM-DD`. The week it falls in is the week read. */
  dueOn: string
  testId: string
}) {
  const { t } = useTranslation()
  const load = useTeamLoad(dueOn || null)
  if (!departmentId || !departmentName) return null
  if (load.isLoading) return <span className="muted">…</span>
  if (load.isError) return <span className="muted" data-testid={`${testId}-failed`}>{t('timing.load.failed')}</span>

  const people = load.groups.flatMap((g) => g.people).filter((p) => p.departmentId === departmentId)
  if (people.length === 0) {
    return <span className="is-warn" data-testid={testId}>{t('timing.load.nobody', { department: departmentName })}</span>
  }
  const booked = people.reduce((n, p) => n + p.bookedHours, 0)
  const nominal = people.reduce((n, p) => n + p.nominalHours, 0)
  const pct = nominal > 0 ? Math.round((booked / nominal) * 100) : 0
  const level = capacityLevel(pct)
  const key = booked === 0 ? 'nothing' : level === 'ok' ? 'fine' : level === 'warn' ? 'busy' : 'over'
  // The frame's colours (Edward, 24 Sep): "nothing booked" is amber like a full week — a
  // department with nothing on its books that week is worth a look, not a green light.
  const tone = key === 'fine' ? 'ok' : 'warn'
  return (
    <span className={`is-${tone}`} data-testid={testId} data-level={level}>
      {t(`timing.load.${key}`, { department: departmentName, pct })}
    </span>
  )
}
