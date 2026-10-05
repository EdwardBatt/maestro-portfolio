import type { RoleScope } from '../../../app/permissions'
import type { TeamLoadGroup, TeamLoadPerson } from '../api/team-api'
import type { TeamTask } from '../api/team-view-api'
import { iraqDay } from '../../../lib/time/iraq'

/**
 * The team / department view, as pure functions (I59.12, ADR-0105 d.4) — what the screen shows is
 * decided here and tested here; the components only draw it.
 */

const DAY_MS = 86_400_000

// ---------------------------------------------------------------- scope

export type ViewScope =
  | { kind: 'team'; id: string }
  | { kind: 'department'; id: string; picker: boolean }
  /** a team- or department-scoped role with no team / department yet — today's message */
  | { kind: 'unplaced' }
  /** a picker role, and there is no department to pick */
  | { kind: 'empty' }

/**
 * Who sees what (d.4): a team lead or deputy — their team; a department lead — their department;
 * anyone else holding `team:view` — a department picker that opens on their own department if they
 * have one, else the first alphabetically (Q5). A scoped role never falls through to the org.
 */
export function resolveScope(
  viewer: { scope: RoleScope | null; teamId: string | null; departmentId: string | null },
  picked: string | null,
  departments: readonly { id: string; name: string }[],
): ViewScope {
  if (viewer.scope === 'team') return viewer.teamId ? { kind: 'team', id: viewer.teamId } : { kind: 'unplaced' }
  if (viewer.scope === 'department')
    return viewer.departmentId ? { kind: 'department', id: viewer.departmentId, picker: false } : { kind: 'unplaced' }
  const known = (id: string | null) => (id && departments.some((d) => d.id === id) ? id : null)
  const first = [...departments].sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null
  const id = known(picked) ?? known(viewer.departmentId) ?? first
  return id ? { kind: 'department', id, picker: true } : { kind: 'empty' }
}

// ---------------------------------------------------------------- people and sections

export interface Section {
  key: string
  /** the team's name; null for a team view's single section (no heading) or for "No team" */
  label: string | null
  kind: 'team' | 'none' | 'all'
  people: TeamLoadPerson[]
  /** the section's own week % */
  pct: number
}

/** Booked over nominal across a set of people, as a whole percent. */
export function groupPct(people: readonly TeamLoadPerson[]): number {
  const nominal = people.reduce((n, p) => n + p.nominalHours, 0)
  const booked = people.reduce((n, p) => n + p.bookedHours, 0)
  return nominal > 0 ? Math.round((booked / nominal) * 100) : 0
}

const byName = (a: TeamLoadPerson, b: TeamLoadPerson) => a.name.localeCompare(b.name)

/**
 * The rows, in their sections. A team is one section with no heading. A department is one section
 * per team (the team's % on its heading), then "No team" for its people on none (Q4).
 */
export function sectionsFor(groups: readonly TeamLoadGroup[], scope: ViewScope): Section[] {
  const everyone = groups.flatMap((g) => g.people)
  if (scope.kind === 'team') {
    const people = everyone.filter((p) => p.teamId === scope.id).sort(byName)
    return people.length ? [{ key: `team:${scope.id}`, label: null, kind: 'all', people, pct: groupPct(people) }] : []
  }
  if (scope.kind !== 'department') return []
  const inDept = everyone.filter((p) => p.departmentId === scope.id)
  const teams = new Map<string, { label: string; people: TeamLoadPerson[] }>()
  const none: TeamLoadPerson[] = []
  for (const p of inDept) {
    if (!p.teamId) {
      none.push(p)
      continue
    }
    const t = teams.get(p.teamId) ?? { label: p.teamName ?? '', people: [] }
    t.people.push(p)
    teams.set(p.teamId, t)
  }
  const out: Section[] = [...teams.entries()]
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([id, t]) => {
      const people = t.people.sort(byName)
      return { key: `team:${id}`, label: t.label, kind: 'team' as const, people, pct: groupPct(people) }
    })
  if (none.length) out.push({ key: 'none', label: null, kind: 'none', people: none.sort(byName), pct: groupPct(none) })
  return out
}

// ---------------------------------------------------------------- the week

export function startOfWeekUtc(now = Date.now()): number {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime() - d.getUTCDay() * DAY_MS
}

export interface WeekDay {
  epoch: number
  isoDate: string
}

export function weekDays(weekStart: number): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const epoch = weekStart + i * DAY_MS
    return { epoch, isoDate: new Date(epoch).toISOString().slice(0, 10) }
  })
}

// ---------------------------------------------------------------- bars

/** The part of a booking the bars need. */
export interface BarBooking {
  id: string
  resourceId: string
  subTaskId: string | null
  start: number
  end: number
}

export type BarState = 'review' | 'changes' | null

export interface Bar {
  taskId: string
  /** the resource row it sits on; null = "Nobody yet" */
  resourceId: string | null
  /** first and last column (0–6), inclusive */
  from: number
  to: number
  lane: number
  state: BarState
  late: boolean
  /** an unassigned task with no dates: a chip in the Nobody yet row's wrapping strip, not on a day */
  undated: boolean
}

/** The state tag: in review, or sent back with changes requested (a round done, work reopened). */
export function barState(task: Pick<TeamTask, 'status' | 'revisionNumber'>): BarState {
  if (task.status === 'review') return 'review'
  if (task.revisionNumber >= 1 && (task.status === 'todo' || task.status === 'in_progress')) return 'changes'
  return null
}

/**
 * What colours a bar, and what the key names (I67.3, Edward 30 Sep, A): the task's STATUS, not its workstream.
 * Order is the key's order. Nobody on it wins (it is on the Nobody yet row); then a block (ADR-0107 — an input
 * the task is waiting on); then where the round is. Done work stays drawn, in green, when its days are on screen.
 */
export type TimelineStatus = 'notStarted' | 'inProgress' | 'review' | 'changes' | 'blocked' | 'unassigned' | 'done'
export const TIMELINE_STATUSES: readonly TimelineStatus[] = ['notStarted', 'inProgress', 'review', 'changes', 'blocked', 'unassigned', 'done']

export function timelineStatus(
  task: Pick<TeamTask, 'status' | 'revisionNumber' | 'waitingOn'>,
  resourceId: string | null,
): TimelineStatus {
  if (task.status === 'done') return 'done'
  if (resourceId == null) return 'unassigned'
  if (task.waitingOn) return 'blocked'
  if (task.status === 'review') return 'review'
  if (barState(task) === 'changes') return 'changes'
  return task.status === 'in_progress' ? 'inProgress' : 'notStarted'
}

/** Late: past its committed date and not done, or drawn past it. Iraq days (ADR-0076). */
export function isLate(task: Pick<TeamTask, 'committedDueAt' | 'status'>, lastDayIso: string | null, now: number): boolean {
  if (!task.committedDueAt || task.status === 'done' || task.status === 'cancelled') return false
  const committed = iraqDay(task.committedDueAt)
  return iraqDay(now) > committed || (lastDayIso != null && lastDayIso > committed)
}

const colOf = (days: readonly WeekDay[], epoch: number) => {
  for (let i = days.length - 1; i >= 0; i -= 1) if (epoch >= days[i]!.epoch) return i
  return -1
}

/**
 * One bar per task per row, over its booked days this week (Q9). Work nobody has yet sits on the
 * "Nobody yet" row from its start to its due, clipped to the week; with no dates at all, it is
 * marked `undated` (drawn as a chip across the week, on no day, taking no lane). Overlapping bars in
 * a row take lanes, first come first placed.
 */
export function layoutBars(
  tasks: readonly TeamTask[],
  bookings: readonly BarBooking[],
  days: readonly WeekDay[],
  rowIds: ReadonlySet<string>,
  now: number,
): Bar[] {
  const weekStart = days[0]!.epoch
  const weekEnd = days[days.length - 1]!.epoch + DAY_MS
  const taskIds = new Set(tasks.map((t) => t.id))
  const spans = new Map<string, { taskId: string; resourceId: string; from: number; to: number }>()
  for (const b of bookings) {
    if (!b.subTaskId || !taskIds.has(b.subTaskId) || !rowIds.has(b.resourceId)) continue
    if (b.end <= weekStart || b.start >= weekEnd) continue
    const from = Math.max(0, colOf(days, Math.max(b.start, weekStart)))
    const to = Math.max(from, colOf(days, Math.min(b.end - 1, weekEnd - 1)))
    const key = `${b.subTaskId}|${b.resourceId}`
    const cur = spans.get(key)
    spans.set(key, cur ? { ...cur, from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { taskId: b.subTaskId, resourceId: b.resourceId, from, to })
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const raw: Omit<Bar, 'lane'>[] = [...spans.values()].map((s) => {
    const t = byId.get(s.taskId)!
    return { ...s, state: barState(t), late: isLate(t, days[s.to]!.isoDate, now), undated: false }
  })
  for (const t of tasks) {
    if (t.assigneeId) continue
    const s = t.startsAt ? Date.parse(t.startsAt) : null
    const e = t.dueAt ? Date.parse(t.dueAt) : null
    const undated = s == null && e == null
    if (!undated && ((e != null && e < weekStart) || (s != null && s >= weekEnd))) continue
    const from = undated || s == null || s < weekStart ? 0 : Math.max(0, colOf(days, s))
    const to = undated ? 0 : e == null || e >= weekEnd ? days.length - 1 : Math.max(from, colOf(days, e))
    raw.push({ taskId: t.id, resourceId: null, from, to, state: barState(t), late: isLate(t, undated ? null : days[to]!.isoDate, now), undated })
  }
  // Lanes, per row.
  const lanesOf = new Map<string, number[]>()
  return raw
    .sort((a, b) => a.from - b.from || a.to - b.to || a.taskId.localeCompare(b.taskId))
    .map((bar) => {
      // Undated work is not on a day — it is drawn as a chip under the row's lanes, and takes none.
      if (bar.undated) return { ...bar, lane: 0 }
      const key = bar.resourceId ?? '__nobody__'
      const lanes = lanesOf.get(key) ?? []
      let lane = lanes.findIndex((lastTo) => lastTo < bar.from)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(bar.to)
      } else lanes[lane] = bar.to
      lanesOf.set(key, lanes)
      return { ...bar, lane }
    })
}

/** The workstreams on screen, for the key: each once, in name order. */
export function workstreamsOnScreen(tasks: readonly TeamTask[], bars: readonly Bar[]): { id: string; name: string; campaignName: string | null }[] {
  const shown = new Set(bars.map((b) => b.taskId))
  const m = new Map<string, { id: string; name: string; campaignName: string | null }>()
  for (const t of tasks) {
    if (!shown.has(t.id) || !t.workstreamId) continue
    if (!m.has(t.workstreamId)) m.set(t.workstreamId, { id: t.workstreamId, name: t.workstreamName ?? '', campaignName: t.campaignName })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- labels

/**
 * A task's label on the team view: "Piece · Step". Task titles are composed "Step — Piece", so the
 * trailing " — <piece name>" is dropped when it IS the piece's name — otherwise the piece would
 * read twice. Any other title is left as written.
 */
export function taskLabel(task: Pick<TeamTask, 'pieceName' | 'title'>): string {
  const piece = task.pieceName?.trim() || null
  let step = task.title.trim()
  if (piece) {
    // " — <piece>" at the end, or before a unit number ("Create Artwork — Social statics 3") or the
    // translation's languages ("Translation — Static Post (English, Arabic)") — I67.1: the piece read twice.
    const at = step.indexOf(` — ${piece}`)
    const rest = at > 0 ? step.slice(at + 3 + piece.length) : null
    if (rest != null && (rest === '' || /^ (\d+|\(.*\))$/.test(rest))) step = `${step.slice(0, at)}${rest}`.trim()
  }
  return [piece, step].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------- by person

export type PersonLine =
  | { kind: 'ceiling' }
  | { kind: 'waiting'; on: string }
  | { kind: 'nothing' }
  | { kind: 'free'; days: string[] }
  | null

/**
 * The one plain line under a person (plan View 7): at the ceiling · waiting on an input · nothing
 * booked · the days they are free. The first that holds, in that order; none when the week is
 * simply full and under the ceiling.
 */
export function personLine(
  person: Pick<TeamLoadPerson, 'level' | 'bookedHours'>,
  tasks: readonly Pick<TeamTask, 'waitingOn'>[],
  freeDays: readonly string[],
): PersonLine {
  if (person.level === 'over') return { kind: 'ceiling' }
  const waiting = tasks.find((t) => t.waitingOn)
  if (waiting?.waitingOn) return { kind: 'waiting', on: waiting.waitingOn }
  if (person.bookedHours <= 0 && tasks.length === 0) return { kind: 'nothing' }
  if (freeDays.length > 0) return { kind: 'free', days: [...freeDays] }
  return null
}

/** The working days in the week a resource has nothing booked on. */
export function freeDaysOf(
  resourceId: string,
  bookings: readonly BarBooking[],
  days: readonly WeekDay[],
  isWorking: (day: WeekDay) => boolean,
): WeekDay[] {
  return days.filter((d) => {
    if (!isWorking(d)) return false
    const end = d.epoch + DAY_MS
    return !bookings.some((b) => b.resourceId === resourceId && b.start < end && b.end > d.epoch)
  })
}

// ---------------------------------------------------------------- by piece

/** What bites first: unassigned and late first, then by due (committed, else planned), undated last. */
export function sortByPiece<T extends Pick<TeamTask, 'id' | 'assigneeId' | 'committedDueAt' | 'dueAt' | 'status'>>(
  rows: readonly T[],
  now: number,
): T[] {
  const urgent = (t: T) => (t.assigneeId == null || isLate(t, null, now) ? 0 : 1)
  const due = (t: T) => {
    const at = t.committedDueAt ?? t.dueAt
    return at ? Date.parse(at) : Number.POSITIVE_INFINITY
  }
  return [...rows].sort((a, b) => urgent(a) - urgent(b) || due(a) - due(b) || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- load

export interface LoadSentence {
  over: string[]
  empty: string[]
}

/** Who is over their warn level and who has nothing, for one week's line. */
export function loadSentence(people: readonly Pick<TeamLoadPerson, 'name' | 'utilPct' | 'warnPct'>[]): LoadSentence {
  return {
    over: people.filter((p) => p.utilPct >= p.warnPct).map((p) => p.name),
    empty: people.filter((p) => p.utilPct === 0).map((p) => p.name),
  }
}

/** The figures' filters on By piece: At risk (ADR-0075's pieces), Unassigned, In review. */
export type PieceFilter = 'atRisk' | 'unassigned' | 'review' | null

export function applyPieceFilter(tasks: readonly TeamTask[], filter: PieceFilter, atRisk: ReadonlySet<string>): TeamTask[] {
  if (filter === 'unassigned') return tasks.filter((x) => x.assigneeId == null)
  if (filter === 'review') return tasks.filter((x) => x.status === 'review')
  if (filter === 'atRisk') return tasks.filter((x) => atRisk.has(x.id))
  return [...tasks]
}


// ---------------------------------------------------------------- "Nobody yet" (I59 E1)

/**
 * Which work nobody has yet belongs on this view (E1, Edward 25 Sep). A team: the tasks on pieces
 * OWNED by someone in the team — the owner is who assigns them (ADR-0100); nothing else puts a task
 * there. A department: every unassigned task in the department — placed on it, or on a piece of it
 * (a piece's department follows its owner, ADR-0102).
 */
export function inNobodyYet(
  task: Pick<TeamTask, 'assigneeId' | 'ownerId' | 'departmentId' | 'deliverableDepartmentId'>,
  scope: ViewScope,
  teamOwners: ReadonlySet<string>,
): boolean {
  if (task.assigneeId != null) return false
  if (scope.kind === 'team') return task.ownerId != null && teamOwners.has(task.ownerId)
  if (scope.kind === 'department') return task.departmentId === scope.id || task.deliverableDepartmentId === scope.id
  return false
}

// ---------------------------------------------------------------- "For" (I59 E2)

export type ForState = 'review' | 'unassigned' | 'blocked' | 'inProgress' | 'assigned'

/**
 * How long a task has been in the state it is in — real time, not planned hours (E2): in review
 * since sent; unassigned since the task list's approval; blocked (an open input on the task or its
 * piece, assigned work not yet sent) since the input was raised; in progress since the round's
 * Start; assigned but not started since it was given out. Null when the state has no clock we can
 * read — a round sent back and not yet re-started among them.
 */
export function timeInState(
  task: Pick<
    TeamTask,
    'status' | 'assigneeId' | 'revisionNumber' | 'assignedAt' | 'tasksApprovedAt' | 'roundStartedAt' | 'roundSentAt' | 'blockedSince'
  >,
): { state: ForState; since: string | null } | null {
  if (task.status === 'done' || task.status === 'cancelled') return null
  if (task.status === 'review') return { state: 'review', since: task.roundSentAt }
  if (task.assigneeId == null) return { state: 'unassigned', since: task.tasksApprovedAt }
  if (task.blockedSince) return { state: 'blocked', since: task.blockedSince }
  if (task.status === 'in_progress') return { state: 'inProgress', since: task.roundStartedAt }
  // todo, with an assignee. After a send-back the assignment is not when this state began.
  if (task.revisionNumber >= 1) return null
  return { state: 'assigned', since: task.assignedAt }
}

export type Duration = { unit: 'underHour' } | { unit: 'hours' | 'days'; count: number }

/** Under a day, whole hours ("5h"); from a day, whole days ("1 day", "2 days"). Never negative. */
export function durationSince(since: string, now: number): Duration {
  const ms = Math.max(0, now - Date.parse(since))
  if (ms < DAY_MS) {
    const h = Math.floor(ms / 3_600_000)
    return h < 1 ? { unit: 'underHour' } : { unit: 'hours', count: h }
  }
  return { unit: 'days', count: Math.floor(ms / DAY_MS) }
}

// ---------------------------------------------------------------- a drop the drag cannot finish

/**
 * A drop from "Nobody yet" that would be refused, so the assignment dialog opens instead with the
 * task chosen (settled 25 Sep): the task has no reviewer, or its only reviewers include the person
 * it lands on (a maker never reviews their own work — the database's deferred rule), or it has no
 * hours (E11: a task is not assigned without hours). Null = the drag can assign it as it is.
 */
export function assignDialogReason(
  task: Pick<TeamTask, 'assigneeId' | 'reviewerIds' | 'hours'>,
  targetUserId: string | null,
): 'reviewer' | 'hours' | null {
  if (task.assigneeId != null) return null
  if (task.reviewerIds.length === 0 || (targetUserId != null && task.reviewerIds.includes(targetUserId))) return 'reviewer'
  if (task.hours == null || !(task.hours > 0)) return 'hours'
  return null
}

/** The dialog's hours a day for a task's hours over its days, to the field's half-hour step. */
export function hoursPerDayOf(hours: number | null, spanDays: number): string {
  if (hours == null || !(hours > 0)) return ''
  return String(Math.max(0.5, Math.round((hours / Math.max(1, spanDays)) * 2) / 2))
}
