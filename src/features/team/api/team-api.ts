import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useScheduleResources, type ScheduleResource } from '../../schedule/api/schedule-api'
import { useBookingsList, useMyBookingsList, type BookingListRow } from '../../bookings/api/bookings-api'
import { weekLoadPct } from '../../schedule/lib/week-load'
import { hoursByDay, type MyDay } from '../lib/my-week'
import { formatCalendarDay } from '../../../lib/time/iraq'

/** teamId → parent departmentId, so a resource tagged only with a team still
 *  resolves to its department (ADR-0014 hierarchy-aware department scope). */
function useTeamDepartmentIndex() {
  return useQuery({
    queryKey: ['team', 'dept-index'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, string | null>> => {
      const { data, error } = await supabaseUntyped.from('teams').select('id, department_id')
      if (error) throw error
      const m = new Map<string, string | null>()
      for (const t of (data ?? []) as { id: string; department_id: string | null }[]) m.set(t.id, t.department_id)
      return m
    },
  })
}

/**
 * Team surface (interim — a light first cut of M6.3). Composes the existing
 * resource pool and this-week's bookings into a per-person load view: booked
 * hours this week, booking count, and a nominal-week utilisation indicator.
 * Read-only, gated by `team:view`.
 *
 * Scope note: reads are tenant-wide (RLS), and the JWT carries only tenant+role
 * — not the viewer's team/department — so this shows the whole org grouped by
 * team. Per-viewer scoping (a lead sees only their own team) lands with the
 * full M6.3 surface; until then the grouping makes each team legible at a glance.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Current week, Sunday 00:00 → next Sunday 00:00 (local), plus a display label.
 *  Sunday-start to match the working week (Sun–Fri, MENA). */
export function currentWeek(now: Date = new Date()): { start: string; end: string; label: string } {
  const diffToSun = now.getDay() // getDay: 0=Sun..6=Sat → days since Sunday
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToSun)
  const nextSun = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 7)
  const sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6)
  return { start: sun.toISOString(), end: nextSun.toISOString(), label: `${formatCalendarDay(iso(sun))} – ${formatCalendarDay(iso(sat))}` }
}

const NOMINAL_DAY_HOURS = 8

/** Capacity state for the week (ADR-0018 exception): ok < warn (warn_at_pct,
 *  default 100%) ≤ warn < over (load_ceiling_pct, default 120%) ≤ over. */
export type LoadLevel = 'ok' | 'warn' | 'over'

/** The single capacity-level rule, shared by every tier (self / team / company). */
export function capacityLevel(utilPct: number, warnPct = 100, ceilingPct = 120): LoadLevel {
  return utilPct >= ceilingPct ? 'over' : utilPct >= warnPct ? 'warn' : 'ok'
}

export interface TeamLoadPerson {
  id: string
  /** I59 Track 6 — the login behind the resource, so My Work can find the viewer's own row. */
  userId?: string | null
  name: string
  nickname: string | null
  teamId: string | null
  teamName: string | null
  /** the person's own department, or their team's parent department if unset
   *  (ADR-0014). Used to scope the surface to a department lead's domain. */
  departmentId: string | null
  departmentName: string | null
  bookedHours: number
  bookingCount: number
  /** nominal full-week hours from the office working week (fallback 5×8). */
  nominalHours: number
  /** bookedHours / nominalHours, as a whole percent (0 when nominal is 0). */
  utilPct: number
  /** warn-at threshold as a percent (from the resource; default 100). */
  warnPct: number
  /** over-ceiling threshold as a percent (from the resource; default 120). */
  ceilingPct: number
  /** ok / warn (≥ warn, < ceiling) / over (≥ ceiling). */
  level: LoadLevel
  /** convenience: level === 'over'. */
  over: boolean
}

export interface TeamLoadGroup {
  key: string
  label: string
  /** 'team' | 'department' | 'none' — what the grouping fell back to. */
  kind: 'team' | 'department' | 'none'
  people: TeamLoadPerson[]
}

export interface TeamLoad {
  week: { start: string; end: string; label: string }
  groups: TeamLoadGroup[]
  isLoading: boolean
  isError: boolean
}

/**
 * Composes resources + one week's bookings into grouped per-person load.
 *
 * This week by default. `weekOf` moves the window to the week a given day falls in — ADR-0083
 * d.10: an intake screen shows the department's load for the week the work is DUE, because
 * this week's number answers a question nobody on that screen asked. An unreadable date falls
 * back to this week rather than to nothing.
 */
export function useTeamLoad(weekOf?: string | Date | null, opts?: { live?: boolean }): TeamLoad {
  const anchor = weekOf ? new Date(weekOf) : null
  const week = currentWeek(anchor && !Number.isNaN(anchor.getTime()) ? anchor : new Date())
  const resources = useScheduleResources(opts)
  const bookings = useBookingsList({ start: week.start, end: week.end }, opts)
  const deptIndex = useTeamDepartmentIndex()

  const rows: ScheduleResource[] = resources.data ?? []
  const books: BookingListRow[] = bookings.data ?? []
  const teamDept = deptIndex.data ?? new Map<string, string | null>()

  // Aggregate this-week hours + counts per resource.
  const agg = new Map<string, { hours: number; count: number }>()
  for (const b of books) {
    const cur = agg.get(b.resourceId) ?? { hours: 0, count: 0 }
    cur.hours += b.hours
    cur.count += 1
    agg.set(b.resourceId, cur)
  }

  const people: TeamLoadPerson[] = rows
    .filter((r) => r.kind === 'human')
    .map((r) => {
      const a = agg.get(r.id) ?? { hours: 0, count: 0 }
      const workingDays = r.office?.workingDays?.length ?? 5
      const nominalHours = workingDays * NOMINAL_DAY_HOURS
      const bookedHours = Math.round(a.hours * 10) / 10
      // One rule with the move warnings' "who has room" (I59.13) — schedule/lib/week-load.
      const utilPct = weekLoadPct(bookedHours, workingDays, NOMINAL_DAY_HOURS)
      const warnPct = r.warnAtPct ?? 100
      const ceilingPct = r.ceilingPct ?? 120
      const level: LoadLevel = capacityLevel(utilPct, warnPct, ceilingPct)
      const departmentId = r.departmentId ?? (r.teamId ? teamDept.get(r.teamId) ?? null : null)
      return {
        id: r.id,
        userId: r.userId ?? null,
        name: r.name,
        nickname: r.nickname,
        teamId: r.teamId,
        teamName: r.teamName,
        departmentId,
        departmentName: r.departmentName,
        bookedHours,
        bookingCount: a.count,
        nominalHours,
        utilPct,
        warnPct,
        ceilingPct,
        level,
        over: level === 'over',
      }
    })

  // Group by team, else department, else Unassigned.
  const groups = new Map<string, TeamLoadGroup>()
  for (const p of people) {
    const kind: TeamLoadGroup['kind'] = p.teamName ? 'team' : p.departmentName ? 'department' : 'none'
    const label = p.teamName ?? p.departmentName ?? '__none__'
    const key = `${kind}:${label}`
    if (!groups.has(key)) groups.set(key, { key, label, kind, people: [] })
    groups.get(key)!.people.push(p)
  }

  const rank: Record<LoadLevel, number> = { over: 0, warn: 1, ok: 2 }
  const ordered = [...groups.values()]
    // Exceptions first (over, then warn), then by hours — the feed surfaces the
    // people needing attention at the top of each group (design draft §6.3).
    .map((g) => ({ ...g, people: g.people.sort((a, b) => rank[a.level] - rank[b.level] || b.bookedHours - a.bookedHours) }))
    .sort((a, b) => {
      if (a.kind === 'none') return 1
      if (b.kind === 'none') return -1
      return a.label.localeCompare(b.label)
    })

  return {
    week,
    groups: ordered,
    isLoading: resources.isLoading || bookings.isLoading || deptIndex.isLoading,
    isError: resources.isError || bookings.isError || deptIndex.isError,
  }
}

export interface MyLoad {
  /** false when the login has no linked human resource (nothing to load). */
  hasResource: boolean
  week: { start: string; end: string; label: string }
  bookedHours: number
  bookingCount: number
  utilPct: number
  level: LoadLevel
  /** I59.10 — the week day by day ("Your week"), Sunday first. Empty without a resource. */
  days: MyDay[]
  /** The standard day the days are read against (8h), and the person's warn level. */
  dayHours: number
  warnPct: number
}

/**
 * Tier-1 (My Work): the signed-in person's OWN capacity this week — the same
 * capacity rule as Team/Company Health, at the individual altitude (ADR-0018
 * §6.5 "same data, different altitudes"). Null resource → hasResource false.
 */
export function useMyLoad(userId: string | null): { data: MyLoad | null; isLoading: boolean; isError: boolean } {
  const week = currentWeek()
  const resources = useScheduleResources()
  const bookings = useMyBookingsList({ start: week.start, end: week.end }, userId)

  const mine = (resources.data ?? []).find((r: ScheduleResource) => r.kind === 'human' && r.userId === userId)
  const books: BookingListRow[] = bookings.data ?? []

  let data: MyLoad | null = null
  if (userId) {
    if (!mine) {
      data = { hasResource: false, week, bookedHours: 0, bookingCount: 0, utilPct: 0, level: 'ok', days: [], dayHours: NOMINAL_DAY_HOURS, warnPct: 100 }
    } else {
      const bookedHours = Math.round(books.reduce((n, b) => n + b.hours, 0) * 10) / 10
      // One rule with the Team page and the move warnings (I59.13) — schedule/lib/week-load.
      const utilPct = weekLoadPct(bookedHours, mine.office?.workingDays?.length ?? 5, NOMINAL_DAY_HOURS)
      data = {
        hasResource: true,
        week,
        bookedHours,
        bookingCount: books.length,
        utilPct,
        level: capacityLevel(utilPct, mine.warnAtPct ?? 100, mine.ceilingPct ?? 120),
        days: hoursByDay(books, new Date(week.start), mine.office?.workingDays),
        dayHours: NOMINAL_DAY_HOURS,
        warnPct: mine.warnAtPct ?? 100,
      }
    }
  }

  return {
    data,
    isLoading: resources.isLoading || bookings.isLoading,
    isError: resources.isError || bookings.isError,
  }
}
