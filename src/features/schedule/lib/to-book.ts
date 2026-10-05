import { iraqDay } from '../../../lib/time/iraq'
import { taskInReach, type ViewerReach } from './team-reach.ts'

/**
 * "To book" — the pieces with work nobody is on yet (I74.21, Figma L SC-01 / SC-02b).
 *
 * The rows come from `useToBook` (unassigned, live tasks on pieces whose work may be handed out); this
 * file only orders, narrows and counts them, so every rule the list shows is a unit-tested function.
 */

export interface ToBookTask {
  id: string
  departmentId: string | null
  teamId: string | null
  /** the task's planned hours (`sla_hours`) */
  hours: number | null
}

export interface ToBookPiece {
  deliverableId: string
  name: string
  /** "DA-003" — the piece's code, searchable */
  code: string | null
  campaignId: string
  campaignName: string
  clientId: string | null
  clientName: string | null
  dueAt: string | null
  /** since when the work has been waiting for someone — the list approval, else the oldest unbooked task */
  waitingSince: string
  /** the unbooked tasks' hours, summed */
  hours: number
  tasks: ToBookTask[]
}

export type DueFilter = 'any' | 'overdue' | 'thisWeek' | 'nextWeek' | 'later' | 'none'
export const DUE_FILTERS: DueFilter[] = ['any', 'overdue', 'thisWeek', 'nextWeek', 'later', 'none']

export interface ToBookFilter {
  query: string
  clientId: string
  campaignId: string
  due: DueFilter
}

export const NO_FILTER: ToBookFilter = { query: '', clientId: '', campaignId: '', due: 'any' }

/** Longest waiting first; then the earlier due date; then by name, so the order is stable. */
export function orderToBook(pieces: readonly ToBookPiece[]): ToBookPiece[] {
  const due = (p: ToBookPiece) => (p.dueAt ? Date.parse(p.dueAt) : Number.POSITIVE_INFINITY)
  return [...pieces].sort(
    (a, b) =>
      Date.parse(a.waitingSince) - Date.parse(b.waitingSince) ||
      due(a) - due(b) ||
      a.name.localeCompare(b.name),
  )
}

/** Only the pieces with at least one unbooked task on the viewer's own team (SC-02b "Only your team's pieces"). */
export function piecesInReach(pieces: readonly ToBookPiece[], reach: ViewerReach): ToBookPiece[] {
  if (reach.kind === 'all') return [...pieces]
  return pieces.filter((p) => p.tasks.some((t) => taskInReach(t, reach)))
}

const DAY = 86_400_000
const isoPlus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
/** The Sunday that starts the week an ISO day is in. */
const sundayOf = (iso: string) => isoPlus(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay())

export function dueBucket(dueAt: string | null, todayIso: string): Exclude<DueFilter, 'any'> {
  if (!dueAt) return 'none'
  const day = iraqDay(dueAt)
  if (day < todayIso) return 'overdue'
  const nextSunday = isoPlus(sundayOf(todayIso), 7)
  if (day < nextSunday) return 'thisWeek'
  if (day < isoPlus(nextSunday, 7)) return 'nextWeek'
  return 'later'
}

/** Search reads the name, the code, the campaign and the client — the four things a person types. */
export function filterToBook(pieces: readonly ToBookPiece[], f: ToBookFilter, todayIso: string): ToBookPiece[] {
  const q = f.query.trim().toLocaleLowerCase()
  return pieces.filter((p) => {
    if (f.clientId && p.clientId !== f.clientId) return false
    if (f.campaignId && p.campaignId !== f.campaignId) return false
    if (f.due !== 'any' && dueBucket(p.dueAt, todayIso) !== f.due) return false
    if (!q) return true
    return [p.name, p.code ?? '', p.campaignName, p.clientName ?? ''].some((s) => s.toLocaleLowerCase().includes(q))
  })
}

export interface Option { id: string; name: string; count: number }

function countBy(pieces: readonly ToBookPiece[], key: (p: ToBookPiece) => [string | null, string | null]): Option[] {
  const m = new Map<string, Option>()
  for (const p of pieces) {
    const [id, name] = key(p)
    if (!id) continue
    const o = m.get(id) ?? { id, name: name ?? '', count: 0 }
    o.count += 1
    m.set(id, o)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** The client menu, most pieces first, each with its count (SC-02b). */
export function clientOptions(pieces: readonly ToBookPiece[]): Option[] {
  return countBy(pieces, (p) => [p.clientId, p.clientName])
}

/** The campaign menu — within the chosen client when one is chosen. */
export function campaignOptions(pieces: readonly ToBookPiece[], clientId: string): Option[] {
  return countBy(clientId ? pieces.filter((p) => p.clientId === clientId) : pieces, (p) => [p.campaignId, p.campaignName])
}

/** "Waiting 40 min" / "Waiting 5h" / "Waiting 3d" — the unit is the largest whole one. */
export function waitingFor(sinceIso: string, nowMs: number): { unit: 'min' | 'h' | 'd'; n: number } {
  const mins = Math.max(0, Math.floor((nowMs - Date.parse(sinceIso)) / 60_000))
  if (mins < 60) return { unit: 'min', n: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { unit: 'h', n: hours }
  return { unit: 'd', n: Math.floor(hours / 24) }
}

/** A long wait is the one worth a colour: past four hours, the label turns (SC-01's "Waiting 5h"). */
export const LONG_WAIT_MS = 4 * 3_600_000
