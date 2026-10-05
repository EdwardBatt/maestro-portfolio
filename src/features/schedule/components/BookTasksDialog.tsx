import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { usePermissions } from '../../../app/permissions'
import { iraqDay } from '../../../lib/time/iraq'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { hoursToLoadPct, STANDARD_DAY_HOURS } from '../../../lib/capacity/day-hours.ts'
import { namedRefusal, refusalSentence } from '../../../lib/errors/classify'
import { useAssignableUsers, useRemoveSubTask, useReviewers, useUpsertSubTask } from '../../deliverables/api/deliverables-api'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { lacksRequiredReviewer, reviewerPayload, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { blocksWholeDay, internalHoursOn } from '../../../lib/capacity/blocked-time.ts'
import { askHintKey } from '../../../lib/task-asks/asks'
import { requestTaskBooking, taskAskKeys, useAskAnswerers } from '../../../lib/task-asks/api'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import { useAddDependency, useRemoveDependency, useTaskDependencies } from '../../deliverables/api/requirements-api'
import {
  readTaskListGate,
  useScheduleBlackouts,
  useScheduleBookings,
  useScheduleResources,
  useUpdateTaskAssignment,
  type ScheduleResource,
} from '../api/schedule-api'
import { usePieceTasks, usePieceWorkflow } from '../api/book-api'
import { useWriteScope } from '../hooks/use-write-scope.ts'
import { daySpan } from '../lib/day-span.ts'
import { dayLoad, freeHoursOf, internalLoad, weekNote, type DayLoad } from '../lib/day-load.ts'
import {
  applyBulk,
  checkPlan,
  daysBeforeDue,
  hoursPerDay,
  isAcceptableTaskName,
  isNewRow,
  isoPlus,
  bookButtonCounts,
  isReady,
  planSummary,
  workDays,
  type PlanRow,
  type RowWarning,
} from '../lib/book-plan.ts'
import { dayLong, dayRange, dayTiny, weekdayName } from '../lib/day-words.ts'
import type { ToBookPiece } from '../lib/to-book.ts'
import { Avatar } from './Avatar'
import { DatesPicker } from './DatesPicker'
import { PeoplePicker, type AskChoice, type PersonOption } from './PeoplePicker'
import { PieceBriefTab } from './PieceBriefTab'
import { PieceFilesTab } from './PieceFilesTab'
import { Popover } from './Popover'
import { usePieceFiles } from '../api/book-api'

/**
 * "Book Post 2's tasks" (I74.22 / I74.23, Figma L SC-03 … SC-17, SC-03b/c). Opens when a day is
 * clicked with a piece picked from To book. Every unbooked task of the piece is a row: its hours, its
 * person, its days and what it waits for. Nothing is written until the button; then each ready row is
 * booked through `update_task_assignment` — the one assignment path (ADR-0060), which also decides
 * whether the write is an assignment or a request (ADR-0087 / ADR-0139) — and the server's answer is
 * what the page reports.
 *
 * Warnings sit on the row and in the footer and never disable the button (ADR-0061 d.2). The over-a-
 * day check is the grid's own (`dayLoad` → `overloadFor`), with this window's plan added in.
 */
export interface BookTasksDialogProps {
  piece: ToBookPiece
  /** the day clicked — the calendars open on its week */
  isoDate: string
  /** the person whose row was clicked (Edward, 4 Oct: the rows come in with that person and that day) */
  resourceId?: string | null
  /** the people Who offers — the viewer's own team (ADR-0139 d.6) */
  team: ScheduleResource[]
  /** every resource, to name and measure whoever a task ends up with */
  allResources: ScheduleResource[]
  onClose: () => void
  /**
   * A sentence for the page once everything asked for has gone through, and what Undo takes back
   * (SC-18's toast): the tasks booked and the asks sent in this press.
   */
  onBooked: (summary: string, undo?: { subTaskIds: string[]; requestIds: string[] }) => void
}

/** A row sent to another team instead of booked (ADR-0139 d.2, SC-15). */
interface RowAsk extends AskChoice {
  teamName: string | null
  /** the calendar of the person asked for, when one was — for the avatar and the name */
  resourceId: string | null
}

type Open =
  | { kind: 'who' | 'dates' | 'waits'; key: string; anchor: HTMLElement }
  | { kind: 'add' | 'bulkWho' | 'bulkDay'; anchor: HTMLElement }

const DAY = 86_400_000
const sundayOf = (iso: string) => isoPlus(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay())

export function BookTasksDialog({ piece, isoDate, resourceId: clickedResourceId = null, team, allResources, onClose, onBooked }: BookTasksDialogProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const today = iraqDay(Date.now())
  const sunday = sundayOf(isoDate)
  const dueIso = piece.dueAt ? iraqDay(piece.dueAt) : null

  // Six weeks around the picked week: the calendars can be stepped on, and each day shows its hours.
  const span = useMemo(() => {
    const start = Date.parse(`${sunday}T00:00:00Z`) - 7 * DAY
    return { start, end: start + 49 * DAY }
  }, [sunday])
  const bookings = useScheduleBookings(span)
  const blackouts = useScheduleBlackouts(span)
  const pieceTasks = usePieceTasks(piece.deliverableId)
  const deps = useTaskDependencies(piece.deliverableId)
  const workflow = usePieceWorkflow(piece.deliverableId)
  const files = usePieceFiles(piece.deliverableId)
  const assignable = useAssignableUsers()
  const { departmentId: myDept, teamId: myTeam, scope } = usePermissions()
  const { inWriteReach, routeFor } = useWriteScope()
  const qc = useQueryClient()
  const reviewerOptions = useReviewers()
  /**
   * Who checks the work (I74.22, Edward 3 Oct): chosen with the existing picker — several, the first
   * required and the rest optional — with NO default, and required before Book. It applies to every
   * task booked or asked in this press (ADR-0038 / ADR-0089: no work is given out unreviewed).
   */
  const [reviewers, setReviewers] = useState<ReviewerAppointment[]>([])
  /** ADR-0139 d.1: an account manager / account director books nobody directly — every pick is an ask. */
  const askOnly = scope === 'account' || scope === 'all_accounts'
  const [asks, setAsks] = useState<Record<string, RowAsk>>({})

  const updateTask = useUpdateTaskAssignment()
  const upsert = useUpsertSubTask()
  const remove = useRemoveSubTask()
  const addDep = useAddDependency(piece.deliverableId)
  const removeDep = useRemoveDependency(piece.deliverableId)

  const [tab, setTab] = useState<'tasks' | 'brief' | 'files'>('tasks')
  const [rows, setRows] = useState<PlanRow[] | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<{ title: string; waiting: number; prev: PlanRow[]; removedId: string | null } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPerson, setBulkPerson] = useState<string | null>(null)
  const [bulkDay, setBulkDay] = useState<string | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [newSeq, setNewSeq] = useState(1)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ key: string; text: string }[]>([])
  const [booked, setBooked] = useState<Set<string>>(new Set())
  const close = useCallback(() => setOpen(null), [])

  // The rows: the piece's unbooked tasks, each with what it already waits for.
  useEffect(() => {
    if (rows || !pieceTasks.data || !deps.data) return
    const unbooked = pieceTasks.data.filter((x) => x.assigneeId == null && x.status !== 'done')
    // Edward, 4 Oct: the person and the day clicked on the grid are already chosen on every row — a person in the
    // viewer's own team (anyone else is an ask, picked in Who); the warnings say if the day is too full.
    const startPerson = clickedResourceId && team.some((r) => r.id === clickedResourceId) ? clickedResourceId : null
    setRows(unbooked.map((x) => ({
      key: x.id,
      subTaskId: x.id,
      title: x.title,
      hours: x.hours ?? 0,
      resourceId: startPerson,
      from: startPerson ? isoDate : null,
      to: startPerson ? isoDate : null,
      waitsFor: deps.data.filter((d) => d.subTaskId === x.id).map((d) => d.prerequisiteId),
      workflowStepId: x.workflowStepId,
    })))
  }, [rows, pieceTasks.data, deps.data, clickedResourceId, team, isoDate])

  const plan = useMemo(() => rows ?? [], [rows])
  const resById = useMemo(() => new Map(allResources.map((r) => [r.id, r])), [allResources])
  const bookable = useMemo(() => (assignable.data ? new Set(assignable.data.map((u) => u.id)) : null), [assignable.data])

  const isWorking = useCallback((rid: string, iso: string) => {
    const office = resById.get(rid)?.office
    if (!office) return true
    return isWorkingDay(localDayOf(Date.parse(`${iso}T12:00:00Z`), office.timezone), office)
  }, [resById])
  // ADR-0142 d.4: leave blocks the whole day; internal work counts its hours in the day instead.
  const onLeave = useCallback((rid: string, iso: string) =>
    blocksWholeDay((blackouts.data ?? []).filter((b) => b.resourceId === rid), Date.parse(`${iso}T00:00:00Z`)), [blackouts.data])
  const internalOn = useCallback((rid: string, iso: string) =>
    internalHoursOn((blackouts.data ?? []).filter((b) => b.resourceId === rid), Date.parse(`${iso}T00:00:00Z`),
      (s) => isWorking(rid, new Date(s).toISOString().slice(0, 10))), [blackouts.data, isWorking])
  const bookingsOn = useCallback((rid: string, iso: string) => {
    const s = Date.parse(`${iso}T00:00:00Z`)
    return (bookings.data ?? []).filter((b) => b.resourceId === rid && b.start < s + DAY && b.end > s)
  }, [bookings.data])

  /** The person's day with this window's other rows on it — what Who and Dates show. */
  const loadFor = useCallback((rid: string, iso: string, exceptKey?: string): DayLoad | null => {
    const res = resById.get(rid)
    if (!res) return null
    const planned = plan
      .filter((r) => r.key !== exceptKey && isReady(r) && r.resourceId === rid)
      .flatMap((r) => {
        const days = workDays(r.from!, r.to!, (d) => isWorking(rid, d))
        return days.includes(iso) ? [{ state: 'confirmed' as const, loadPct: hoursToLoadPct(hoursPerDay(r.hours, days.length)) }] : []
      })
    return dayLoad(res, [...bookingsOn(rid, iso), ...internalLoad(internalOn(rid, iso)), ...planned], { nonWorking: !isWorking(rid, iso), onLeave: onLeave(rid, iso) })
  }, [resById, plan, bookingsOn, isWorking, onLeave, internalOn])

  const people: PersonOption[] = useMemo(() => {
    const week = Array.from({ length: 7 }, (_, i) => isoPlus(sunday, i))
    return team
      .filter((r) => r.kind === 'human' && r.userId != null && (bookable == null || bookable.has(r.userId)))
      .map((r) => {
        const days = week.map((iso) => ({ isoDate: iso, load: loadFor(r.id, iso)! }))
        const working = days.filter((d) => d.load.state !== 'off')
        return { resource: r, freeHours: freeHoursOf(days.map((d) => d.load)), weekHours: working.length * STANDARD_DAY_HOURS, note: weekNote(days) }
      })
      .sort((a, b) => b.freeHours - a.freeHours || a.resource.name.localeCompare(b.resource.name))
  }, [team, bookable, sunday, loadFor])
  const freeOf = (rid: string) => people.find((p) => p.resource.id === rid)?.freeHours ?? null

  const others = useMemo(() => {
    const m = new Map<string, { title: string; endsOn: string | null; who: string | null }>()
    for (const x of pieceTasks.data ?? []) {
      if (plan.some((r) => r.key === x.id)) continue
      m.set(x.id, { title: x.title, endsOn: x.dueAt ? iraqDay(x.dueAt) : null, who: x.assigneeName })
    }
    return m
  }, [pieceTasks.data, plan])

  const check = useMemo(() => checkPlan(plan, {
    resources: resById,
    bookingsOn,
    isWorking,
    onLeave,
    dueOn: dueIso,
    others,
  }), [plan, resById, bookingsOn, isWorking, onLeave, dueIso, others])
  const summary = useMemo(() => planSummary(plan, isWorking), [plan, isWorking])
  const rowWarnings = [...check.rows.values()].reduce((n, l) => n + l.length, 0)

  const patch = (key: string, p: Partial<PlanRow>) => setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)))
  const nameOf = (rid: string | null) => (rid ? (resById.get(rid)?.name ?? '') : '')
  // A person is named in full wherever the window names one (I66.1; test script steps 18, 20).
  const fullName = (rid: string | null) => nameOf(rid)

  /** The team a person is in, as the asks read it: their own team first, the calendar's otherwise. */
  const teamNameOf = (teamId: string | null) =>
    teamId ? (allResources.find((x) => x.teamId === teamId)?.teamName ?? null) : null
  function setAsk(key: string, c: AskChoice) {
    const res = c.assigneeId ? allResources.find((x) => x.userId === c.assigneeId && x.kind === 'human') : undefined
    setAsks((m) => ({ ...m, [key]: { ...c, note: m[key]?.note ?? c.note, teamName: teamNameOf(c.teamId), resourceId: res?.id ?? null } }))
    patch(key, { resourceId: null })
  }
  function clearAsk(key: string) {
    setAsks((m) => { const n = { ...m }; delete n[key]; return n })
  }
  /**
   * A pick from Who. Within the viewer's reach it books; outside it (an account manager's every pick,
   * ADR-0139 d.1) the row becomes an ask of that person's team — said on the row before anything is sent.
   */
  function pickPerson(key: string, rid: string) {
    const res = resById.get(rid)
    const row = plan.find((x) => x.key === key)
    if (res && routeFor(res) === 'request') {
      const tm = res.personTeamId ?? res.teamId ?? ''
      setAsk(key, { teamId: tm, assigneeId: res.userId, note: '', neededBy: row?.to ?? isoDate })
      return
    }
    clearAsk(key)
    // A row with no days yet takes the day that was clicked, so picking a person books something.
    patch(key, row && !row.from ? { resourceId: rid, from: isoDate, to: isoDate } : { resourceId: rid })
  }

  function removeRow(r: PlanRow) {
    const prev = plan
    const waiting = plan.filter((x) => x.waitsFor.includes(r.key)).length
    setRows(plan.filter((x) => x.key !== r.key).map((x) => ({ ...x, waitsFor: x.waitsFor.filter((w) => w !== r.key) })))
    clearAsk(r.key)
    if (r.subTaskId) setRemovedIds((s) => new Set(s).add(r.subTaskId!))
    setSelected((s) => { const n = new Set(s); n.delete(r.key); return n })
    setUndo({ title: r.title, waiting, prev, removedId: r.subTaskId })
  }

  function addRow(title: string, hours: number, workflowStepId: string | null, nameIt: boolean) {
    const key = `new:${newSeq}`
    setNewSeq((n) => n + 1)
    const last = plan[plan.length - 1]
    setRows([...plan, { key, subTaskId: null, title, hours, resourceId: null, from: null, to: null, waitsFor: last ? [last.key] : [], workflowStepId }])
    if (nameIt) setNaming(key)
  }

  const stepWords = (i: number, steps: { title: string }[]) =>
    i === 0 ? t('schedule.sc.add.first') : i === steps.length - 1 ? t('schedule.sc.add.last') : t('schedule.sc.add.after', { task: steps[i - 1]!.title })

  function warningText(w: RowWarning): string {
    switch (w.kind) {
      case 'over': return t('schedule.sc.warn.over', { name: nameOf(w.resourceId), hours: w.totalHours, day: weekdayName(w.isoDate, lang), over: w.overHours })
      case 'order': return t('schedule.sc.warn.order', { day: weekdayName(w.startsOn, lang), task: w.prerequisite, ends: weekdayName(w.prerequisiteEndsOn, lang), next: weekdayName(w.suggestOn, lang) })
      case 'late': return t('schedule.sc.warn.late', { ends: dayLong(w.endsOn, lang), due: dayLong(w.dueOn, lang) })
      case 'leave': return t('schedule.sc.warn.leave', { name: nameOf(w.resourceId), day: dayLong(w.isoDate, lang) })
      case 'off': return t('schedule.sc.warn.off', { name: nameOf(w.resourceId), day: dayLong(w.isoDate, lang) })
    }
  }

  // ---- booking -------------------------------------------------------------------------------
  async function book() {
    setErrors([])
    // Who checks the work is chosen, never assumed (Edward, 3 Oct) — and nobody checks their own.
    if (reviewers.length === 0) return setErrors([{ key: 'reviewers', text: t('schedule.asks.reviewers.required') }])
    if (lacksRequiredReviewer(reviewers)) return setErrors([{ key: 'reviewers', text: t('reviewers.oneRequired') }])
    const selfCheck = plan.find((r) => isReady(r) && !asks[r.key] && reviewers.some((v) => v.userId === resById.get(r.resourceId!)?.userId))
    if (selfCheck) return setErrors([{ key: selfCheck.key, text: t('schedule.asks.reviewers.ownWork', { name: nameOf(selfCheck.resourceId) }) }])
    setBusy(true)
    const errs: { key: string; text: string }[] = []
    const done = new Set(booked)
    let asked = 0
    const bookedIds: string[] = []
    const requestIds: string[] = []
    const say = (e: unknown) => {
      const x = e as { code?: string; message?: string }
      const hk = askHintKey(e)
      return (hk ? t(hk) : null) ?? namedRefusal(e, t) ?? refusalSentence(x) ?? x.message ?? t('schedule.createFailed')
    }
    // ADR-0139 d.2: the ask. It carries the hours and who checks the work; the lead's booking writes them onto the task
    // (I74.53) — the asker does not edit the task, so an account manager can ask too.
    const sendAsk = async (r: PlanRow, subTaskId: string) => {
      const a = asks[r.key]!
      const id = await requestTaskBooking({
        subTaskId,
        teamId: a.teamId,
        assigneeId: a.assigneeId,
        hours: r.hours,
        neededBy: a.neededBy,
        note: a.note,
        reviewers: reviewerPayload(reviewers),
      })
      requestIds.push(id)
    }
    const assign = async (r: PlanRow, subTaskId: string, title: string) => {
      const res = resById.get(r.resourceId!)!
      const tz = res.office?.timezone ?? 'UTC'
      const days = workDays(r.from!, r.to!, (d) => isWorking(res.id, d))
      const per = hoursPerDay(r.hours, days.length)
      const out = await updateTask.mutateAsync({
        subTaskId,
        title,
        assigneeId: res.userId!,
        reviewers,
        startsAt: new Date(daySpan(days[0]!, per, tz).start).toISOString(),
        dueAt: new Date(daySpan(days[days.length - 1]!, per, tz).end).toISOString(),
        hours: r.hours,
        reviewMode: null,
      })
      if (out.outcome === 'requested') { asked += 1; if (out.requestId) requestIds.push(out.requestId) } else bookedIds.push(subTaskId)
      if (out.scheduleWarning) errs.push({ key: r.key, text: t('schedule.sc.book.unscheduled', { task: title }) })
    }

    try {
      // 1 — what was taken off the list.
      for (const id of removedIds) {
        try { await remove.mutateAsync(id) } catch (e) { errs.push({ key: id, text: say(e) }) }
      }
      // 2 — the tasks already on the piece, ready to book.
      for (const r of plan) {
        if (isNewRow(r) || done.has(r.key)) continue
        if (asks[r.key]) {
          try { await sendAsk(r, r.subTaskId!); done.add(r.key) } catch (e) { errs.push({ key: r.key, text: `${r.title}: ${say(e)}` }) }
          continue
        }
        if (!isReady(r)) continue
        try { await assign(r, r.subTaskId!, r.title); done.add(r.key) } catch (e) { errs.push({ key: r.key, text: `${r.title}: ${say(e)}` }) }
      }
      // 3 — the tasks added here: written onto the piece (placed where the caller may write, ADR-0060 d.9).
      const created = new Map<string, string>()
      for (const r of plan) {
        if (!isNewRow(r) || done.has(r.key)) continue
        const res = r.resourceId ? resById.get(r.resourceId) : undefined
        const u = res?.userId ? assignable.data?.find((x) => x.id === res.userId) : undefined
        const onAssignee = res != null && inWriteReach(res)
        try {
          const made = await upsert.mutateAsync({
            deliverableId: piece.deliverableId,
            title: r.title,
            assigneeId: null,
            reviewers: null,
            departmentId: onAssignee ? (u?.departmentId ?? null) : (myDept ?? null),
            teamId: onAssignee ? (u?.teamId ?? null) : (myTeam ?? null),
            slaHours: r.hours,
            materialise: false,
          })
          created.set(r.key, made.id)
        } catch (e) { errs.push({ key: r.key, text: `${r.title}: ${say(e)}` }) }
      }
      // A task added by anyone but the owner re-opens an approved list (ADR-0132 d.4); work on a list
      // waiting for approval cannot be given out (I71.2). Then the new rows stop at "added".
      let listOpen = true
      let owner: string | null = null
      if (created.size > 0) {
        const gate = await readTaskListGate(piece.deliverableId)
        listOpen = gate.approved
        owner = gate.ownerName
      }
      for (const r of plan) {
        const id = created.get(r.key)
        if (!id) continue
        done.add(r.key)
        if (!isReady(r) && !asks[r.key]) continue
        if (!listOpen) { errs.push({ key: r.key, text: owner ? t('schedule.addedAwaitingList', { task: r.title, owner }) : t('schedule.addedAwaitingListNoName', { task: r.title }) }); continue }
        try { if (asks[r.key]) await sendAsk(r, id); else await assign(r, id, r.title) } catch (e) { errs.push({ key: r.key, text: `${r.title}: ${say(e)}` }) }
      }
      // 4 — what each task waits for, as the rows now say.
      const idOf = (key: string) => created.get(key) ?? (key.startsWith('new:') ? null : key)
      for (const r of plan) {
        const id = idOf(r.key)
        if (!id) continue
        const want = new Set(r.waitsFor.map(idOf).filter((x): x is string => !!x))
        const have = (deps.data ?? []).filter((d) => d.subTaskId === id)
        for (const d of have) if (!want.has(d.prerequisiteId)) { try { await removeDep.mutateAsync(d.id) } catch (e) { errs.push({ key: r.key, text: say(e) }) } }
        for (const w of want) if (!have.some((d) => d.prerequisiteId === w)) { try { await addDep.mutateAsync({ subTaskId: id, prerequisiteId: w }) } catch (e) { errs.push({ key: r.key, text: say(e) }) } }
      }
    } finally {
      setBusy(false)
    }

    setBooked(done)
    // Every view of these tasks re-reads — the Schedule pop-up's task list included (test script step 14).
    invalidateTaskViews(qc)
    void qc.invalidateQueries({ queryKey: taskAskKeys.all })
    if (errs.length) { setErrors(errs); setRemovedIds(new Set()); return }
    const list = (xs: string[]) => new Intl.ListFormat(lang === 'ar' ? 'ar' : 'en-GB', { type: 'conjunction' }).format(xs)
    const directRows = plan.filter((r) => isReady(r) && !asks[r.key])
    const n = directRows.length - asked
    const names = [...new Set(directRows.map((r) => fullName(r.resourceId)))]
    const askRows = plan.filter((r) => asks[r.key])
    const teams = [...new Set(askRows.map((r) => asks[r.key]!.teamName ?? '').filter(Boolean))]
    const parts: string[] = []
    if (n > 0) parts.push(t('schedule.asks.toast.booked', { count: n, names: list(names) }))
    if (askRows.length > 0) parts.push(t('schedule.asks.toast.asked', { count: askRows.length, teams: list(teams), tasks: list(askRows.map((r) => r.title)) }))
    if (asked > 0) parts.push(t('schedule.asks.toast.askedVia', { count: asked }))
    onBooked(parts.join(' · ') + '.' + (n > 0 ? ` ${t('schedule.asks.toast.told', { count: names.length, names: list(names) })}` : ''), { subTaskIds: bookedIds, requestIds })
    onClose()
  }

  // ---- the footer's one line ---------------------------------------------------------------------
  const askKeys = plan.filter((r) => asks[r.key]).map((r) => r.key)
  const askN = askKeys.length
  const readyN = plan.filter((r) => isReady(r) && !asks[r.key]).length
  // The button counts what will happen: a pick outside the booker's reach is sent as an ask (an account manager's
  // every pick), so it is never labelled "Book" (test script, 4 Oct).
  const button = bookButtonCounts(plan, (r) => asks[r.key] != null, (rid) => { const res = resById.get(rid); return res != null && routeFor(res) === 'request' })
  const workflowName = (lang === 'ar' ? workflow.data?.nameAr : null) ?? workflow.data?.name ?? null
  const byPerson = summary.byPerson.map((p) => t('schedule.sc.foot.forPerson', { count: p.count, name: fullName(p.resourceId) })).join(', ')
  // An ask is part of the plan too (SC-15: "11 of about 12 hours planned · 2 tasks for Zubaida · 1 ask to the Copy team").
  const plannedAll = Math.round((summary.plannedHours + plan.filter((r) => asks[r.key]).reduce((n, r) => n + r.hours, 0)) * 10) / 10
  const askWords = askN > 0 ? t('schedule.asks.foot.asks', { count: askN, team: [...new Set(askKeys.map((k) => asks[k]!.teamName ?? ''))].filter(Boolean).join(', ') }) : null
  const withSomeone = summary.withPerson + askN
  let footTone: 'idle' | 'ok' | 'warn' | 'bad' = 'idle'
  let footText: string
  if (rowWarnings > 0) {
    footTone = 'bad'
    footText = t('schedule.sc.foot.check', { count: check.count })
  } else if (check.combined.length > 0) {
    footTone = 'warn'
    const c = check.combined[0]!
    footText = t('schedule.sc.foot.combined', { hours: c.totalHours, name: fullName(c.resourceId), day: dayLong(c.isoDate, lang), over: c.overHours })
  } else if (plan.length > 0 && readyN + askN === plan.length && (summary.lastDay || askN > 0)) {
    footTone = 'ok'
    const ahead = dueIso && summary.lastDay ? daysBeforeDue(summary.lastDay, dueIso) : null
    footText = [
      t('schedule.sc.foot.hoursOf', { planned: plannedAll, about: piece.hours }),
      summary.lastDay ? t('schedule.sc.foot.doneOn', { day: dayTiny(summary.lastDay, lang, sunday) }) + (ahead == null ? '' : ahead === 0 ? t('schedule.sc.foot.onDue') : t('schedule.sc.foot.ahead', { count: ahead })) : null,
      byPerson,
      askWords,
    ].filter(Boolean).join(' · ')
  } else if (withSomeone === 0) {
    footText = [t('schedule.sc.foot.planned', { planned: plannedAll, about: piece.hours }), t('schedule.sc.foot.nobody', { count: plan.length })].join(' · ')
  } else {
    footText = [
      t('schedule.sc.foot.planned', { planned: plannedAll, about: piece.hours }),
      withSomeone === plan.length && (byPerson || askWords) ? [byPerson, askWords].filter(Boolean).join(' · ') : t('schedule.sc.foot.havePerson', { n: withSomeone, count: plan.length }),
    ].join(' · ')
  }
  const hint = undo
    ? t('schedule.sc.hint.removed')
    : naming
      ? t('schedule.sc.hint.naming')
      : footTone === 'ok'
        ? t('schedule.sc.hint.ready', { names: [...new Set(plan.filter(isReady).map((r) => fullName(r.resourceId)))].join(', ') })
        : summary.withPerson > 0
          ? (readyN < plan.length && summary.withPerson === plan.length ? t('schedule.sc.hint.needsDays') : t('schedule.sc.hint.nothingYet'))
          : workflowName
            ? t('schedule.sc.hint.fromWorkflow', { workflow: workflowName })
            : t('schedule.sc.hint.nothingYet')

  const allTicked = plan.length > 0 && plan.every((r) => selected.has(r.key))
  const loading = rows == null

  // ---- popovers ------------------------------------------------------------------------------
  const openRow = open && 'key' in open ? plan.find((r) => r.key === open.key) ?? null : null
  const steps = workflow.data?.steps ?? []
  const offeredSteps = steps.filter((s) => !plan.some((r) => r.workflowStepId === s.id || r.title.trim().toLowerCase() === s.title.trim().toLowerCase()))
  const workingCols = (rid: string | null) => {
    const wd = (rid ? resById.get(rid)?.office?.workingDays : null) ?? [7, 1, 2, 3, 4]
    return wd.map((d) => d % 7)
  }

  return (
    <Modal onClose={onClose} labelledById="book-tasks-title" testId="book-tasks" size="wide">
      <div className="sc-book">
        <header className="sc-book-head">
          <p className="sc-book-eyebrow"><span className="sc-dot" aria-hidden="true" />{piece.campaignName}</p>
          <h2 id="book-tasks-title" className="sc-book-title">{t('schedule.sc.book.title', { piece: piece.name })}</h2>
          <p className="sc-book-sub">{t('schedule.sc.book.sub', { hours: piece.hours, due: dueIso ? dayLong(dueIso, lang) : '—' })}</p>
          <IconButton icon="close" label={t('schedule.sc.close')} className="sc-book-x" onClick={onClose} data-testid="book-tasks-close" />
        </header>
        <div className="sc-tabs" role="tablist">
          {(['tasks', 'brief', 'files'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)} data-testid={`book-tab-${k}`}>
              {k === 'files' ? t('schedule.sc.tab.filesN', { n: files.data?.files.length ?? 0 }) : t(`schedule.sc.tab.${k}`)}
            </button>
          ))}
        </div>

        <div className="sc-book-body">
          {tab === 'brief' && <PieceBriefTab deliverableId={piece.deliverableId} hours={piece.hours} />}
          {tab === 'files' && <PieceFilesTab deliverableId={piece.deliverableId} pieceName={piece.name} />}
          {tab === 'tasks' && (loading ? <p className="muted" data-testid="book-tasks-loading">…</p> : (
            <>
              <div className="sc-trow sc-thead">
                <input type="checkbox" checked={allTicked} aria-label={t('schedule.sc.selectAll')}
                  onChange={() => setSelected(allTicked ? new Set() : new Set(plan.map((r) => r.key)))} data-testid="book-select-all" />
                <span>{t('schedule.sc.col.task')}</span>
                <span>{t('schedule.sc.col.hours')}</span>
                <span>{t('schedule.sc.col.who')}</span>
                <span>{t('schedule.sc.col.dates')}</span>
                <span />
              </div>
              {selected.size > 0 && (
                <div className="sc-bulk" data-testid="book-bulk">
                  <strong>{t('schedule.sc.bulk.selected', { count: selected.size })}</strong>
                  <span className="sc-bulk-sep" />
                  <span>{t('schedule.sc.bulk.giveTo')}</span>
                  <button type="button" className="sc-bulk-pick" onClick={(e) => setOpen({ kind: 'bulkWho', anchor: e.currentTarget })} data-testid="book-bulk-who">
                    {bulkPerson ? fullName(bulkPerson) : t('schedule.sc.bulk.pickPerson')} ▾
                  </button>
                  <span>{t('schedule.sc.bulk.on')}</span>
                  <button type="button" className="sc-bulk-pick" onClick={(e) => setOpen({ kind: 'bulkDay', anchor: e.currentTarget })} data-testid="book-bulk-day">
                    {bulkDay ? dayTiny(bulkDay, lang, sunday) : t('schedule.sc.bulk.pickDay')} ▾
                  </button>
                  <span className="sc-grow" />
                  <Button variant="primary" size="sm" disabled={!bulkPerson && !bulkDay}
                    onClick={() => setRows(applyBulk(plan, selected, bulkPerson, bulkDay))} data-testid="book-bulk-apply">
                    {t('schedule.sc.bulk.apply', { count: selected.size })}
                  </Button>
                  <button type="button" className="sc-bulk-clear" onClick={() => { setSelected(new Set()); setBulkPerson(null); setBulkDay(null) }} data-testid="book-bulk-clear">
                    {t('schedule.sc.bulk.clear')}
                  </button>
                </div>
              )}
              {plan.map((r, i) => {
                const warns = check.rows.get(r.key) ?? []
                const tone = warns.some((w) => w.kind === 'over' || w.kind === 'late' || w.kind === 'leave') ? 'bad' : warns.length ? 'warn' : ''
                const waitTitles = r.waitsFor.map((w) => plan.find((x) => x.key === w)?.title ?? others.get(w)?.title).filter(Boolean)
                const free = r.resourceId ? freeOf(r.resourceId) : null
                const personWarn = warns.find((w) => w.kind === 'over') as Extract<RowWarning, { kind: 'over' }> | undefined
                const isNamingRow = naming === r.key
                return (
                  <div key={r.key} className={`sc-tblock${tone ? ` is-${tone}` : ''}${asks[r.key] ? ' is-ask' : ''}${isNamingRow ? ' is-naming' : ''}${booked.has(r.key) ? ' is-booked' : ''}`} data-testid={`book-row-${r.key}`}>
                    <div className="sc-trow">
                      <input type="checkbox" checked={selected.has(r.key)} aria-label={t('schedule.sc.selectRow', { task: r.title })}
                        onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}
                        data-testid={`book-select-${r.key}`} />
                      <span className="sc-task">
                        <span className="sc-num">{i + 1}</span>
                        <span className="sc-task-text">
                          {isNamingRow ? (
                            <input
                              autoFocus
                              className="sc-name-input"
                              value={r.title}
                              maxLength={200}
                              onChange={(e) => patch(r.key, { title: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); if (isAcceptableTaskName(r.title)) setNaming(null) }
                                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(null); setRows(plan.filter((x) => x.key !== r.key)) }
                              }}
                              aria-label={t('schedule.sc.add.nameLabel')}
                              data-testid={`book-name-${r.key}`}
                            />
                          ) : (
                            <span className="sc-task-name">{r.title}</span>
                          )}
                          <button type="button" className="sc-waits" onClick={(e) => setOpen({ kind: 'waits', key: r.key, anchor: e.currentTarget })} data-testid={`book-waits-${r.key}`}>
                            {waitTitles.length === 0 ? t('schedule.sc.waits.any') : waitTitles.length === 1 ? t('schedule.sc.waits.one', { task: waitTitles[0] }) : t('schedule.sc.waits.many', { task: waitTitles[0], count: waitTitles.length - 1 })} ▾
                          </button>
                        </span>
                      </span>
                      <span className="sc-stepper" role="group" aria-label={t('schedule.sc.col.hours')}>
                        <button type="button" aria-label={t('schedule.sc.less')} onClick={() => patch(r.key, { hours: Math.max(0.5, r.hours - 1) })} data-testid={`book-less-${r.key}`}>−</button>
                        <span data-testid={`book-hours-${r.key}`}>{t('schedule.sc.hours', { n: r.hours })}</span>
                        <button type="button" aria-label={t('schedule.sc.more')} onClick={() => patch(r.key, { hours: r.hours + 1 })} data-testid={`book-more-${r.key}`}>+</button>
                      </span>
                      {asks[r.key] ? (
                        <>
                          <AskWhoField ask={asks[r.key]!} open={open?.kind === 'who' && open.key === r.key}
                            onClick={(e) => setOpen({ kind: 'who', key: r.key, anchor: e.currentTarget })} testId={`book-who-${r.key}`} />
                          <button type="button" className={`sc-field sc-field-dates is-set${open?.kind === 'dates' && open.key === r.key ? ' is-open' : ''}`}
                            onClick={(e) => setOpen({ kind: 'dates', key: r.key, anchor: e.currentTarget })} data-testid={`book-dates-${r.key}`}>
                            <span className="sc-field-main">{asks[r.key]!.neededBy ? t('schedule.asks.row.by', { day: dayTiny(asks[r.key]!.neededBy!, lang, sunday) }) : t('schedule.sc.pickDates')}</span>
                            <span className="sc-caret" aria-hidden="true">▾</span>
                          </button>
                        </>
                      ) : (
                        <>
                      <button type="button" className={`sc-field${r.resourceId ? ' is-set' : ''}${personWarn ? ' is-bad' : ''}${open?.kind === 'who' && open.key === r.key ? ' is-open' : ''}`}
                        onClick={(e) => setOpen({ kind: 'who', key: r.key, anchor: e.currentTarget })} data-testid={`book-who-${r.key}`}>
                        {r.resourceId ? (
                          <>
                            <Avatar id={r.resourceId} name={nameOf(r.resourceId)} size={18} />
                            <span className="sc-field-text">
                              <span className="sc-field-main">{nameOf(r.resourceId)}</span>
                              {personWarn
                                ? <span className="sc-field-sub is-bad">{t('schedule.sc.cell.overOn', { n: personWarn.overHours, day: weekdayName(personWarn.isoDate, lang).slice(0, lang === 'ar' ? undefined : 3) })}</span>
                                : free != null && <span className="sc-field-sub">{t('schedule.sc.freeThisWeek', { n: free })}</span>}
                            </span>
                          </>
                        ) : <span className="sc-field-ph">{t('schedule.sc.pickPerson')}</span>}
                        <span className="sc-caret" aria-hidden="true">▾</span>
                      </button>
                      <button type="button" className={`sc-field sc-field-dates${r.from ? ' is-set' : ''}${warns.some((w) => w.kind === 'late') ? ' is-bad' : warns.some((w) => w.kind === 'order') ? ' is-warn' : ''}${open?.kind === 'dates' && open.key === r.key ? ' is-open' : ''}`}
                        onClick={(e) => setOpen({ kind: 'dates', key: r.key, anchor: e.currentTarget })} data-testid={`book-dates-${r.key}`}>
                        {r.from && r.to ? <span className="sc-field-main">{dayRange(r.from, r.to, lang, sunday)}</span> : <span className="sc-field-ph">{t('schedule.sc.pickDates')}</span>}
                        <span className="sc-caret" aria-hidden="true">▾</span>
                      </button>
                        </>
                      )}
                      <IconButton icon="close" size="sm" label={t('schedule.sc.removeTask', { task: r.title })} onClick={() => removeRow(r)} data-testid={`book-remove-${r.key}`} />
                    </div>
                    {isNamingRow && <p className="sc-row-note">{t('schedule.sc.add.nameHint')}</p>}
                    {asks[r.key] && (
                      <AskRowDetail ask={asks[r.key]!} onNote={(note) => setAsks((m) => ({ ...m, [r.key]: { ...m[r.key]!, note } }))}
                        onChange={(e) => setOpen({ kind: 'who', key: r.key, anchor: e.currentTarget })} testId={`book-ask-${r.key}`} />
                    )}
                    {warns.map((w, wi) => <p key={wi} className={`sc-row-warn is-${w.kind === 'order' || w.kind === 'off' ? 'warn' : 'bad'}`} data-testid={`book-warn-${r.key}`}>{warningText(w)}</p>)}
                    {errors.filter((x) => x.key === r.key).map((x, xi) => <p key={xi} className="sc-row-warn is-bad" role="alert" data-testid={`book-error-${r.key}`}>{x.text}</p>)}
                  </div>
                )
              })}
              {undo && (
                <div className="sc-undo" data-testid="book-undo">
                  <span>{undo.waiting === 0 ? t('schedule.sc.removed.none', { task: undo.title }) : t('schedule.sc.removed.waiting', { task: undo.title, count: undo.waiting })}</span>
                  <Button variant="link" size="sm" onClick={() => {
                    setRows(undo.prev)
                    if (undo.removedId) setRemovedIds((s) => { const n = new Set(s); n.delete(undo.removedId!); return n })
                    setUndo(null)
                  }} data-testid="book-undo-button">{t('schedule.sc.removed.undo')}</Button>
                </div>
              )}
              <div className="sc-add-line">
                <button type="button" className="sc-add" onClick={(e) => setOpen({ kind: 'add', anchor: e.currentTarget })} data-testid="book-add-task">
                  + {t('schedule.sc.add.button')}
                </button>
                {workflowName && <span className="sc-foot-note">{t('schedule.sc.add.fromWorkflow', { workflow: workflowName })}</span>}
              </div>
              <div className="sc-reviewers" data-testid="book-reviewers">
                <span className="sc-reviewers-label">{t('reviewers.label')}</span>
                <ReviewerPicker options={reviewerOptions.data ?? []} value={reviewers} onChange={setReviewers} testId="book-reviewer" selectClassName="sc-select" />
                <span className="sc-foot-note">{t('schedule.asks.reviewers.hint')}</span>
                {errors.filter((x) => x.key === 'reviewers').map((x, xi) => <p key={xi} className="sc-row-warn is-bad" role="alert" data-testid="book-reviewer-error">{x.text}</p>)}
              </div>
              {errors.filter((x) => x.key !== 'reviewers' && !plan.some((r) => r.key === x.key)).map((x, xi) => <p key={xi} className="form-error" role="alert" data-testid="book-error">{x.text}</p>)}
            </>
          ))}
        </div>

        {tab === 'tasks' && !loading && (
          <p className={`sc-summary is-${footTone}`} data-testid="book-summary">
            <span className="sc-summary-mark" aria-hidden="true">{footTone === 'ok' ? '✓' : footTone === 'bad' ? '!' : '•'}</span>
            {footText}
          </p>
        )}
        <footer className="sc-book-foot">
          <Button variant="primary" className={rowWarnings > 0 ? 'sc-anyway' : ''} busy={busy} disabled={readyN + askN === 0 || loading}
            onClick={() => void book()} data-testid="book-submit">
            {button.ask > 0
              ? (button.book > 0 ? t('schedule.asks.book.bookAndAsk', { count: button.book, asks: t('schedule.asks.book.asks', { count: button.ask }) }) : t('schedule.asks.book.askOnly', { count: button.ask }))
              : rowWarnings > 0 ? t('schedule.sc.book.anyway', { count: button.book }) : t('schedule.sc.book.button', { count: button.book })}
          </Button>
          <Button variant="link" onClick={onClose} data-testid="book-cancel">{t('schedule.cancel')}</Button>
          <span className="sc-foot-note sc-foot-hint">{hint}</span>
        </footer>
      </div>

      {open?.kind === 'who' && openRow && (
        <Popover anchor={open.anchor} onClose={close} width={300} testId="book-who-pop">
          <PeoplePicker
            people={people}
            selectedId={openRow.resourceId}
            onPick={(rid) => { pickPerson(openRow.key, rid); close() }}
            onAsk={(c) => { setAsk(openRow.key, c); close() }}
            askDay={asks[openRow.key]?.neededBy ?? openRow.to ?? isoDate}
            askOnly={askOnly}
            testId="book-who-list"
          />
        </Popover>
      )}
      {open?.kind === 'dates' && openRow && asks[openRow.key] && (
        <Popover anchor={open.anchor} onClose={close} width={360} align="end" testId="book-dates-pop">
          <DatesPicker
            personName={null}
            startSunday={sunday}
            from={asks[openRow.key]!.neededBy}
            to={asks[openRow.key]!.neededBy}
            hours={0}
            dueIso={dueIso}
            todayIso={today}
            workingWeekdays={workingCols(null)}
            isWorking={() => true}
            loadOn={() => null}
            single
            onChange={(from) => setAsks((m) => ({ ...m, [openRow.key]: { ...m[openRow.key]!, neededBy: from } }))}
            onDone={close}
            testId="book-ask-day-picker"
          />
        </Popover>
      )}
      {open?.kind === 'dates' && openRow && !asks[openRow.key] && (
        <Popover anchor={open.anchor} onClose={close} width={360} align="end" testId="book-dates-pop">
          <DatesPicker
            personName={openRow.resourceId ? fullName(openRow.resourceId) : null}
            startSunday={sunday}
            from={openRow.from}
            to={openRow.to}
            hours={openRow.hours}
            dueIso={dueIso}
            todayIso={today}
            workingWeekdays={workingCols(openRow.resourceId)}
            isWorking={(iso) => (openRow.resourceId ? isWorking(openRow.resourceId, iso) : true)}
            loadOn={(iso) => (openRow.resourceId ? loadFor(openRow.resourceId, iso, openRow.key) : null)}
            onChange={(from, to) => patch(openRow.key, { from, to })}
            onDone={close}
            testId="book-dates-picker"
          />
        </Popover>
      )}
      {open?.kind === 'waits' && openRow && (
        <Popover anchor={open.anchor} onClose={close} width={320} testId="book-waits-pop">
          <div className="sc-waits-pop">
            <p className="sc-pop-title">{t('schedule.sc.waits.title', { task: openRow.title })}</p>
            <label className={`sc-check${openRow.waitsFor.length === 0 ? ' is-on' : ''}`}>
              <input type="radio" checked={openRow.waitsFor.length === 0} onChange={() => patch(openRow.key, { waitsFor: [] })} data-testid="book-waits-none" />
              <span><span className="sc-check-main">{t('schedule.sc.waits.nothing')}</span><span className="sc-person-sub">{t('schedule.sc.waits.nothingSub')}</span></span>
            </label>
            {[...plan.filter((x) => x.key !== openRow.key).map((x) => ({ key: x.key, title: x.title, sub: x.resourceId ? [fullName(x.resourceId), x.from ? dayTiny(x.from, lang, sunday) : null].filter(Boolean).join(' · ') : '', n: plan.indexOf(x) + 1 })),
              ...[...others].map(([id, o]) => ({ key: id, title: o.title, sub: [o.who, o.endsOn ? dayTiny(o.endsOn, lang, sunday) : null].filter(Boolean).join(' · '), n: null as number | null }))].map((o) => {
              const on = openRow.waitsFor.includes(o.key)
              return (
                <label key={o.key} className={`sc-check${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => patch(openRow.key, { waitsFor: on ? openRow.waitsFor.filter((w) => w !== o.key) : [...openRow.waitsFor, o.key] })}
                    data-testid={`book-waits-${openRow.key}-${o.key}`} />
                  <span><span className="sc-check-main">{o.n != null ? `${o.n} · ` : ''}{o.title}</span>{o.sub && <span className="sc-person-sub">{o.sub}</span>}</span>
                </label>
              )
            })}
            <p className="sc-pop-foot">{t('schedule.sc.waits.foot')}</p>
          </div>
        </Popover>
      )}
      {open?.kind === 'add' && (
        <Popover anchor={open.anchor} onClose={close} width={300} testId="book-add-pop">
          <div className="sc-add-pop">
            {workflowName && offeredSteps.length > 0 && <p className="sc-pop-title">{t('schedule.sc.add.title', { workflow: workflowName })}</p>}
            {offeredSteps.map((s) => (
              <button key={s.id} type="button" className="sc-menu-item" onClick={() => { addRow(lang === 'ar' ? (s.titleAr ?? s.title) : s.title, s.hours ?? 1, s.id, false); close() }} data-testid={`book-add-step-${s.id}`}>
                <span className="sc-check-main">{lang === 'ar' ? (s.titleAr ?? s.title) : s.title}</span>
                <span className="sc-person-sub">{[stepWords(steps.indexOf(s), steps), s.hours != null ? t('schedule.sc.aboutHours', { n: s.hours }) : null].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            <button type="button" className="sc-menu-item sc-menu-own" onClick={() => { addRow('', 1, null, true); close() }} data-testid="book-add-own">
              <span className="sc-check-main">{t('schedule.sc.add.own')}</span>
              <span className="sc-person-sub">{t('schedule.sc.add.ownSub')}</span>
            </button>
          </div>
        </Popover>
      )}
      {open?.kind === 'bulkWho' && (
        <Popover anchor={open.anchor} onClose={close} width={300} testId="book-bulk-who-pop">
          <PeoplePicker people={people} selectedId={bulkPerson} onPick={(rid) => { setBulkPerson(rid); close() }}
            onAsk={(c) => { for (const k of selected) setAsk(k, c); close() }}
            askDay={bulkDay ?? isoDate}
            askOnly={askOnly}
            testId="book-bulk-who-list" />
        </Popover>
      )}
      {open?.kind === 'bulkDay' && (
        <Popover anchor={open.anchor} onClose={close} width={360} testId="book-bulk-day-pop">
          <DatesPicker
            personName={bulkPerson ? fullName(bulkPerson) : null}
            startSunday={sunday}
            from={bulkDay}
            to={bulkDay}
            hours={0}
            dueIso={dueIso}
            todayIso={today}
            workingWeekdays={workingCols(bulkPerson)}
            isWorking={(iso) => (bulkPerson ? isWorking(bulkPerson, iso) : true)}
            loadOn={(iso) => (bulkPerson ? loadFor(bulkPerson, iso) : null)}
            single
            onChange={(from) => setBulkDay(from)}
            onDone={close}
            testId="book-bulk-day-picker"
          />
        </Popover>
      )}
    </Modal>
  )
}

/** Who on an ask row (SC-15): "Copy team — ask / Amira decides". */
function AskWhoField({ ask, open, onClick, testId }: { ask: RowAsk; open: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; testId: string }) {
  const { t } = useTranslation()
  const lead = useAskLead(ask)
  return (
    <button type="button" className={`sc-field is-set is-ask${open ? ' is-open' : ''}`} onClick={onClick} data-testid={testId}>
      <span className="sc-ask-dot" aria-hidden="true" />
      <span className="sc-field-text">
        <span className="sc-field-main">{t('schedule.asks.row.teamAsk', { team: ask.teamName ?? '' })}</span>
        <span className="sc-field-sub is-ask">{lead ? t('schedule.asks.row.decides', { lead }) : t('schedule.asks.row.leadDecides')}</span>
      </span>
      <span className="sc-caret" aria-hidden="true">▾</span>
    </button>
  )
}

/** The ask's own line under the row (SC-15): TEAM · WHO, the note to the lead, and what happens next. */
function AskRowDetail({ ask, onNote, onChange, testId }: { ask: RowAsk; onNote: (note: string) => void; onChange: (e: React.MouseEvent<HTMLButtonElement>) => void; testId: string }) {
  const { t } = useTranslation()
  const lead = useAskLead(ask)
  const person = usePersonName(ask.resourceId)
  return (
    <div className="sc-ask-detail" data-testid={testId}>
      <div className="sc-ask-detail-line">
        <span className="sc-ask-detail-label">{t('schedule.asks.row.team')}</span>
        <button type="button" className="sc-ask-detail-pick" onClick={onChange} data-testid={`${testId}-team`}>
          {ask.teamName ?? '—'}{lead ? ` · ${t('schedule.asks.row.lead', { lead })}` : ''} ▾
        </button>
        <span className="sc-ask-detail-label">{t('schedule.asks.row.who')}</span>
        <button type="button" className="sc-ask-detail-pick" onClick={onChange} data-testid={`${testId}-who`}>
          {ask.assigneeId ? (person ?? '—') : lead ? t('schedule.asks.row.anyone', { lead }) : t('schedule.asks.row.anyoneNoName')} ▾
        </button>
      </div>
      <input className="sc-ask-note-input" value={ask.note} maxLength={500} onChange={(e) => onNote(e.target.value)}
        placeholder={lead ? t('schedule.asks.row.notePh', { lead }) : t('schedule.asks.row.notePhNoName')}
        aria-label={t('schedule.asks.row.noteLabel')} data-testid={`${testId}-note`} />
      <p className="sc-ask-detail-foot">{lead ? t('schedule.asks.row.nothingUntil', { lead }) : t('schedule.asks.row.nothingUntilNoName')}</p>
    </div>
  )
}

function usePersonName(resourceId: string | null): string | null {
  const resources = useScheduleResources()
  return resourceId ? (resources.data?.find((r) => r.id === resourceId)?.name ?? null) : null
}

/** The answerer's name for an ask (ADR-0139 d.3, the server's own list) — in full (I66.1). */
function useAskLead(ask: RowAsk): string | null {
  const resources = useScheduleResources()
  const sample = ask.resourceId ?? resources.data?.find((r) => r.kind === 'human' && (r.personTeamId ?? r.teamId) === ask.teamId)?.id ?? null
  const answerers = useAskAnswerers(sample)
  const name = answerers.data?.[0]?.name ?? null
  return name
}
