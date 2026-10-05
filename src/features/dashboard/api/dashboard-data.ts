import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { usePermissions } from '../../../app/permissions'
import { useCampaignPulse } from '../../campaigns/api/campaign-pulse-api'
import { useCampaignList } from '../../campaigns/api/campaign-api'
import { useTeamLoad, type TeamLoadPerson } from '../../team/api/team-api'
import { useTeamMemberIds, useTeamViewTasks, type TeamTask } from '../../team/api/team-view-api'
import { inNobodyYet, resolveScope, sectionsFor, type ViewScope } from '../../team/lib/team-view'
import { useScheduleBookings, useScheduleResources } from '../../schedule/api/schedule-api'
import { useTeams, useWorkDepartments } from '../../admin/api/admin-api'
import type { DashCampaign, DashPiece } from '../lib/figures'
import { reachFor, type ApprovalReach, type BriefRow } from '../lib/approvals'
import { pickView } from '../lib/pick-view'
import { weekStartOf } from '../lib/figures'

const DAY_MS = 24 * 60 * 60 * 1000
const LIVE = { live: true } as const

/** The signed-in person's name and job title, for the page's first line (Figma H: "Inas Azmi · Account manager"). */
export function useMe(userId: string | null) {
  return useQuery({
    queryKey: ['dashboard', 'me', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped
        .from('user_profiles')
        .select('display_name, job_title')
        .eq('id', userId!)
        .maybeSingle()
      if (error) throw error
      const row = data as { display_name: string | null; job_title: string | null } | null
      return { name: row?.display_name ?? '', jobTitle: row?.job_title ?? null }
    },
  })
}

/**
 * Every live piece with its campaign, from the campaigns list's own reads (the pulse and the list),
 * so the Dashboard's at-risk and waiting figures are the campaigns list's figures (I57.13).
 */
export function useCompanyWork() {
  const pulse = useCampaignPulse()
  const list = useCampaignList()
  return useMemo(() => {
    const campaigns: DashCampaign[] = []
    const pieces: DashPiece[] = []
    const rows = new Map((list.data ?? []).map((c) => [c.id, c]))
    for (const src of pulse.data?.values() ?? []) {
      const row = rows.get(src.campaignId)
      if (!row || row.status === 'draft') continue
      campaigns.push({
        id: row.id,
        name: row.name,
        clientName: row.clientName,
        goLiveAt: row.goLiveAt,
        status: row.status,
        accountManagerId: src.accountManagerId,
      })
      for (const p of src.pieces) {
        if (p.state === 'archived') continue
        pieces.push({ ...p, id: p.id ?? '', name: p.name ?? '', campaignId: src.campaignId })
      }
    }
    return {
      campaigns,
      pieces,
      statusOf: new Map(campaigns.map((c) => [c.id, c.status])),
      isLoading: pulse.isLoading || list.isLoading,
      isError: pulse.isError || list.isError,
    }
  }, [pulse.data, pulse.isLoading, pulse.isError, list.data, list.isLoading, list.isError])
}

/** Four weeks of load, this week last — the "last four weeks" charts (Figma H). */
export function useLoadWeeks(weekStart: number) {
  const w = (n: number) => new Date(weekStart - n * 7 * DAY_MS + DAY_MS / 2)
  const w3 = useTeamLoad(w(3), LIVE)
  const w2 = useTeamLoad(w(2), LIVE)
  const w1 = useTeamLoad(w(1), LIVE)
  const w0 = useTeamLoad(w(0), LIVE)
  return { weeks: [w3, w2, w1, w0], isLoading: w0.isLoading, isError: w0.isError }
}

/**
 * The people and work of the viewer's team or department — the Team page's scope and read (ADR-0018
 * d.6, I59 d.4), for this week: the people on it, their live tasks, and the work nobody has yet that
 * belongs to it (E1).
 */
export function useScopeWork(weekStart: number) {
  const { scope, teamId, departmentId } = usePermissions()
  const departments = useWorkDepartments()
  const teams = useTeams()
  const view: ViewScope = useMemo(
    () => resolveScope({ scope, teamId, departmentId }, null, departments.data ?? []),
    [scope, teamId, departmentId, departments.data],
  )
  const window = useMemo(() => ({ start: weekStart, end: weekStart + 7 * DAY_MS }), [weekStart])
  const load = useTeamLoad(new Date(weekStart + DAY_MS / 2), LIVE)
  const sections = useMemo(() => sectionsFor(load.groups, view), [load.groups, view])
  const people: TeamLoadPerson[] = useMemo(() => sections.flatMap((s) => s.people), [sections])

  const resourcesQ = useScheduleResources(LIVE)
  const bookingsQ = useScheduleBookings(window, LIVE)
  const resources = useMemo(() => new Map((resourcesQ.data ?? []).map((r) => [r.id, r])), [resourcesQ.data])
  const userIds = useMemo(
    () => people.map((p) => resources.get(p.id)?.userId).filter((u): u is string => u != null),
    [people, resources],
  )
  const rowIds = useMemo(() => new Set(people.map((p) => p.id)), [people])
  const bookedTaskIds = useMemo(
    () => [...new Set((bookingsQ.data ?? []).filter((b) => rowIds.has(b.resourceId) && b.subTaskId).map((b) => b.subTaskId!))],
    [bookingsQ.data, rowIds],
  )
  const members = useTeamMemberIds(view.kind === 'team' ? view.id : null)
  const teamOwners = useMemo<ReadonlySet<string>>(() => new Set(members.data ?? []), [members.data])
  const placed = view.kind === 'team' || view.kind === 'department'
  const tasksQ = useTeamViewTasks(
    {
      assigneeIds: userIds,
      bookedTaskIds,
      ownerIds: view.kind === 'team' ? [...teamOwners] : [],
      departmentId: view.kind === 'department' ? view.id : null,
    },
    window,
    placed && !load.isLoading && !resourcesQ.isLoading && !(view.kind === 'team' && members.isLoading),
  )
  const tasks: TeamTask[] = useMemo(
    () =>
      (tasksQ.data ?? []).filter((x) =>
        x.assigneeId == null ? inNobodyYet(x, view, teamOwners) : userIds.includes(x.assigneeId)),
    [tasksQ.data, userIds, view, teamOwners],
  )
  const scopeName =
    view.kind === 'team'
      ? (teams.data ?? []).find((x) => x.id === view.id)?.name ?? people[0]?.teamName ?? ''
      : view.kind === 'department'
        ? (departments.data ?? []).find((d) => d.id === view.id)?.name ?? ''
        : ''
  return {
    view,
    scopeName,
    sections,
    people,
    userIds,
    tasks,
    isLoading: load.isLoading || departments.isLoading || tasksQ.isLoading,
    isError: load.isError || tasksQ.isError,
  }
}

/** This week's bookings with each resource's kind and name — for clashes (Traffic, I61.3). */
export function useWeekBookings(weekStart: number) {
  const window = useMemo(() => ({ start: weekStart, end: weekStart + 7 * DAY_MS }), [weekStart])
  const bookings = useScheduleBookings(window, LIVE)
  const resources = useScheduleResources(LIVE)
  return useMemo(() => {
    const byId = new Map((resources.data ?? []).map((r) => [r.id, r]))
    return {
      bookings: bookings.data ?? [],
      kindOf: (id: string) => byId.get(id)?.kind,
      nameOf: (id: string) => byId.get(id)?.name ?? '',
      isLoading: bookings.isLoading || resources.isLoading,
    }
  }, [bookings.data, bookings.isLoading, resources.data, resources.isLoading])
}

/** Each piece's allowed rounds of changes (`deliverables.revision_limit`) — "1 of 2 rounds" (Figma H DB-M). */
export function useRevisionLimits(deliverableIds: readonly string[]) {
  const ids = [...new Set(deliverableIds)].sort()
  return useQuery({
    queryKey: ['dashboard', 'revision-limits', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.from('deliverables').select('id, revision_limit').in('id', ids)
      if (error) throw error
      return new Map(((data ?? []) as { id: string; revision_limit: number | null }[]).map((r) => [r.id, r.revision_limit]))
    },
  })
}

/**
 * Every draft and every campaign waiting for its brief's approval, with who started it and its account
 * manager — the Dashboard's "Unfinished briefs" and "Briefs awaiting approval" (I66.2). Tenant-wide, as the
 * campaigns list is; the view decides its reach (`lib/approvals`).
 */
export function useBriefRows() {
  return useQuery({
    queryKey: ['dashboard', 'brief-rows'],
    refetchInterval: 20_000,
    queryFn: async (): Promise<BriefRow[]> => {
      const rows = await allRows<{
        id: string; name: string; status: 'draft' | 'pending_approval'
        account_manager_id: string | null; created_by: string | null; clients: { name: string } | null
      }>((a, b) =>
        supabaseUntyped
          .from('campaigns')
          .select('id, name, status, account_manager_id, created_by, clients(name)')
          .in('status', ['draft', 'pending_approval'])
          .order('id')
          .range(a, b))
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        clientName: r.clients?.name ?? '',
        accountManagerId: r.account_manager_id,
        createdBy: r.created_by,
      }))
    },
  })
}

/** Everyone's full name by user id — who an approval waits on (I66.2). Full names, never nicknames (I66.1). */
export function usePeopleNames() {
  return useQuery({
    queryKey: ['dashboard', 'people-names'],
    queryFn: async () => {
      const rows = await allRows<{ id: string; display_name: string | null }>((a, b) =>
        supabaseUntyped.from('user_profiles').select('id, display_name').order('id').range(a, b))
      return new Map(rows.map((r) => [r.id, r.display_name ?? '']))
    },
  })
}

/**
 * The viewer's Dashboard reach, worked out as the Dashboard works it out (`pickView`, `reachFor`, this week's
 * team or department) — for the list a card opens, so the list holds what the card counted (I66.6).
 */
export function useApprovalReach(myId: string | null): { reach: ApprovalReach | null; isLoading: boolean } {
  const perms = usePermissions()
  const weekStart = useMemo(() => weekStartOf(Date.now()), [])
  const scope = useScopeWork(weekStart)
  if (!perms.ready || !myId) return { reach: null, isLoading: true }
  const view = pickView(perms)
  const placed = view === 'team' || view === 'department'
  return { reach: reachFor(view, myId, scope.userIds), isLoading: placed && scope.isLoading }
}

/** Since when each task list has waited — the database's one clock (ADR-0119 d.3, view `task_list_waiting`). */
export function useTaskListWaiting() {
  return useQuery({
    queryKey: ['dashboard', 'task-list-waiting'],
    refetchInterval: 20_000,
    queryFn: async () => {
      const rows = await allRows<{ deliverable_id: string; since: string | null }>((a, b) =>
        supabaseUntyped.from('task_list_waiting').select('deliverable_id, since').order('deliverable_id').range(a, b))
      return new Map(rows.map((r) => [r.deliverable_id, r.since]))
    },
  })
}
