import { useCallback, useMemo } from 'react'
import { usePermissions } from '../../../app/permissions'
import { useTeams } from '../../admin/api/admin-api'
import { useAssignableUsers } from '../../deliverables/api/deliverables-api'
import { STANDARD_DAY_HOURS, hoursToLoadPct } from '../../../lib/capacity/day-hours.ts'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { useScheduleBlackouts, useScheduleBookings, useScheduleResources, type ScheduleResource } from '../api/schedule-api'
import { daySpan } from '../lib/day-span.ts'
import { dayLoad, freeHoursOf, weekNote, type DayLoad } from '../lib/day-load.ts'
import { hoursPerDay, isoPlus, workDays } from '../lib/book-plan.ts'
import { resourceInReach, viewerReach } from '../lib/team-reach.ts'
import type { PersonOption } from '../components/PeoplePicker'

const DAY = 86_400_000

/** A booking this window would add, so Who and Dates count it before it is saved (SC-04's "with the plan on it"). */
export interface PlannedHours { resourceId: string; from: string; to: string; hours: number; key: string }

/** The Sunday of the week an ISO day falls in. */
export function sundayOfIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return isoPlus(iso, -d.getUTCDay())
}

/**
 * The Schedule's Who and Dates, for any window that books (ADR-0140 d.4: the campaign page uses the same pickers
 * as the Schedule). The same reads the booking window makes — resources, bookings and leave over six weeks
 * around `sundayIso` — and the same day arithmetic (`dayLoad`), so a person's free hours read the same wherever
 * they are offered. Who lists the viewer's own reach (ADR-0139 d.6), else everyone: a picker never dead-ends.
 * Presentation only; the server decides every booking.
 */
export function usePeopleWeek(sundayIso: string, planned: readonly PlannedHours[] = []) {
  const span = useMemo(() => {
    const start = Date.parse(`${sundayIso}T00:00:00Z`) - 7 * DAY
    return { start, end: start + 49 * DAY }
  }, [sundayIso])
  const resources = useScheduleResources()
  const bookings = useScheduleBookings(span)
  const blackouts = useScheduleBlackouts(span)
  const assignable = useAssignableUsers()
  const teams = useTeams()
  const { scope, departmentId, teamId } = usePermissions()
  const reach = useMemo(() => viewerReach(scope, departmentId, teamId), [scope, departmentId, teamId])

  const all = useMemo(() => resources.data ?? [], [resources.data])
  const resById = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])
  const resByUser = useMemo(() => {
    const m = new Map<string, ScheduleResource>()
    for (const r of all) if (r.kind === 'human' && r.userId && !m.has(r.userId)) m.set(r.userId, r)
    return m
  }, [all])
  const teamDept = useMemo(() => new Map((teams.data ?? []).map((tm) => [tm.id, tm.departmentId])), [teams.data])
  const bookable = useMemo(() => (assignable.data ? new Set(assignable.data.map((u) => u.id)) : null), [assignable.data])

  const isWorking = useCallback((rid: string, iso: string) => {
    const office = resById.get(rid)?.office
    if (!office) return true
    return isWorkingDay(localDayOf(Date.parse(`${iso}T12:00:00Z`), office.timezone), office)
  }, [resById])

  const loadOn = useCallback((rid: string, iso: string, exceptKey?: string): DayLoad | null => {
    const res = resById.get(rid)
    if (!res) return null
    const s = Date.parse(`${iso}T00:00:00Z`)
    const booked = (bookings.data ?? []).filter((b) => b.resourceId === rid && b.start < s + DAY && b.end > s)
    const plan = planned
      .filter((p) => p.key !== exceptKey && p.resourceId === rid)
      .flatMap((p) => {
        const days = workDays(p.from, p.to, (d) => isWorking(rid, d))
        return days.includes(iso) ? [{ state: 'confirmed' as const, loadPct: hoursToLoadPct(hoursPerDay(p.hours, days.length)) }] : []
      })
    const leave = (blackouts.data ?? []).some((b) => b.resourceId === rid && b.start < s + DAY && b.end > s)
    return dayLoad(res, [...booked, ...plan], { nonWorking: !isWorking(rid, iso), onLeave: leave })
  }, [resById, bookings.data, blackouts.data, planned, isWorking])

  /** Any list of people as Who shows them — their week's free hours, most room first. */
  const optionsFor = useCallback((list: readonly ScheduleResource[]): PersonOption[] => {
    const week = Array.from({ length: 7 }, (_, i) => isoPlus(sundayIso, i))
    return list
      .map((r) => {
        const days = week.map((iso) => ({ isoDate: iso, load: loadOn(r.id, iso)! }))
        const working = days.filter((d) => d.load.state !== 'off')
        return { resource: r, freeHours: freeHoursOf(days.map((d) => d.load)), weekHours: working.length * STANDARD_DAY_HOURS, note: weekNote(days) }
      })
      .sort((a, b) => b.freeHours - a.freeHours || a.resource.name.localeCompare(b.resource.name))
  }, [sundayIso, loadOn])

  const people: PersonOption[] = useMemo(() => {
    const humans = all.filter((r) => r.kind === 'human' && r.userId != null && (bookable == null || bookable.has(r.userId)))
    const effDept = (r: ScheduleResource) => r.departmentId ?? (r.teamId ? (teamDept.get(r.teamId) ?? null) : null)
    const mine = humans.filter((r) => resourceInReach(r, effDept(r), reach))
    return optionsFor(mine.length > 0 ? mine : humans)
  }, [all, bookable, teamDept, reach, optionsFor])

  /** The columns a person works, as day offsets from Sunday. */
  const workingCols = useCallback((rid: string | null) => {
    const wd = (rid ? resById.get(rid)?.office?.workingDays : null) ?? [7, 1, 2, 3, 4]
    return wd.map((d) => d % 7)
  }, [resById])

  /** What `update_task_assignment` is sent for a person over these days — the booking window's own arithmetic. */
  const spanFor = useCallback((rid: string, from: string, to: string, hours: number): { startsAt: string; dueAt: string } | null => {
    const res = resById.get(rid)
    if (!res) return null
    const tz = res.office?.timezone ?? 'UTC'
    const days = workDays(from, to, (d) => isWorking(rid, d))
    const first = days[0] ?? from
    const last = days[days.length - 1] ?? to
    const per = hoursPerDay(hours, Math.max(1, days.length))
    return {
      startsAt: new Date(daySpan(first, per, tz).start).toISOString(),
      dueAt: new Date(daySpan(last, per, tz).end).toISOString(),
    }
  }, [resById, isWorking])

  return {
    people,
    optionsFor,
    resById,
    resByUser,
    isWorking,
    loadOn,
    workingCols,
    spanFor,
    /** ADR-0139 d.1: a role that books nobody directly (an account manager, the account director) — every pick asks */
    asksOnly: reach.kind === 'none',
    ready: resources.isSuccess,
  }
}
