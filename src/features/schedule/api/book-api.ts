import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { inChunks } from '../../../lib/query/in-chunks'
import { liveOptions } from '../../../lib/query/live'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import type { ToBookPiece, ToBookTask } from '../lib/to-book.ts'
import { scheduleKeys, type LiveOption } from './schedule-api'

/**
 * The Schedule rework's reads (I74.21–I74.24, Figma L): "To book", the piece's workflow, its brief and
 * its files. Existing tables and RPCs only — nothing here adds a rule. What may be handed out is the
 * database's answer (`assignable_deliverables`, the same function the assignment gate reads, ADR-0090
 * d.3a), so the list and the gate cannot disagree.
 */

export const bookKeys = {
  toBook: () => [...scheduleKeys.all, 'to-book'] as const,
  steps: (deliverableId: string) => [...scheduleKeys.all, 'workflow-steps', deliverableId] as const,
  pieceTasks: (deliverableId: string) => [...scheduleKeys.all, 'piece-tasks', deliverableId] as const,
  brief: (deliverableId: string) => [...scheduleKeys.all, 'piece-brief', deliverableId] as const,
  files: (deliverableId: string) => ['library', 'schedule-piece-files', deliverableId] as const,
}

interface TaskRow { id: string; deliverable_id: string; department_id: string | null; team_id: string | null; sla_hours: number | string | null; created_at: string }
interface DeliverableRow { id: string; name: string; code: string | null; due_at: string | null; tasks_approved_at: string | null; stream_id: string | null; state: string }
interface StreamRow { id: string; campaign_id: string }
interface CampaignRow { id: string; name: string; client_id: string | null; status: string }
interface ClientRow { id: string; name: string }

/**
 * Every piece with work nobody is on yet: unassigned, not done or cancelled, on a piece the gate would
 * let be handed out. Refreshes with the grid (ADR-0105 d.5), so a piece booked elsewhere leaves.
 */
export function useToBook(opts?: LiveOption) {
  return useQuery({
    ...liveOptions(opts?.live),
    queryKey: bookKeys.toBook(),
    queryFn: async (): Promise<ToBookPiece[]> => {
      const tasks = await allRows<TaskRow>((a, b) =>
        supabaseUntyped
          .from('sub_tasks')
          .select('id, deliverable_id, department_id, team_id, sla_hours, created_at')
          .is('assignee_id', null)
          .not('status', 'in', '("done","cancelled")')
          .order('id')
          .range(a, b))
      if (tasks.length === 0) return []
      const deliverableIds = [...new Set(tasks.map((t) => t.deliverable_id))]
      const deliverables = await inChunks<DeliverableRow>(deliverableIds, (chunk) =>
        supabaseUntyped.from('deliverables').select('id, name, code, due_at, tasks_approved_at, stream_id, state').in('id', chunk))
      const live = deliverables.filter((d) => d.stream_id && d.state !== 'archived')
      const streams = await inChunks<StreamRow>([...new Set(live.map((d) => d.stream_id!))], (chunk) =>
        supabaseUntyped.from('streams').select('id, campaign_id').in('id', chunk))
      const campaignOfStream = new Map(streams.map((s) => [s.id, s.campaign_id]))
      const campaigns = await inChunks<CampaignRow>([...new Set(streams.map((s) => s.campaign_id))], (chunk) =>
        supabaseUntyped.from('campaigns').select('id, name, client_id, status').in('id', chunk))
      const approved = campaigns.filter((c) => c.status === 'approved')
      // The gate, campaign by campaign: the same function `useProjectTasks` and the assignment trigger read.
      const assignable = new Set<string>()
      await Promise.all(approved.map(async (c) => {
        const { data, error } = await supabaseUntyped.rpc('assignable_deliverables', { p_campaign: c.id })
        if (error) throw error
        for (const d of (data ?? []) as { id: string }[]) assignable.add(d.id)
      }))
      const clients = await inChunks<ClientRow>([...new Set(approved.map((c) => c.client_id).filter((x): x is string => !!x))], (chunk) =>
        supabaseUntyped.from('clients').select('id, name').in('id', chunk))
      const campaignById = new Map(approved.map((c) => [c.id, c]))
      const clientName = new Map(clients.map((c) => [c.id, c.name]))
      const tasksBy = new Map<string, TaskRow[]>()
      for (const t of tasks) tasksBy.set(t.deliverable_id, [...(tasksBy.get(t.deliverable_id) ?? []), t])

      const out: ToBookPiece[] = []
      for (const d of live) {
        if (!assignable.has(d.id)) continue
        const campaign = campaignById.get(campaignOfStream.get(d.stream_id!) ?? '')
        if (!campaign) continue
        const own = tasksBy.get(d.id) ?? []
        const oldest = own.reduce((m, t) => (t.created_at < m ? t.created_at : m), own[0]?.created_at ?? new Date().toISOString())
        const since = d.tasks_approved_at && d.tasks_approved_at > oldest ? d.tasks_approved_at : oldest
        const toTask = (t: TaskRow): ToBookTask => ({ id: t.id, departmentId: t.department_id, teamId: t.team_id, hours: t.sla_hours == null ? null : Number(t.sla_hours) })
        out.push({
          deliverableId: d.id,
          name: d.name,
          code: d.code,
          campaignId: campaign.id,
          campaignName: campaign.name,
          clientId: campaign.client_id,
          clientName: campaign.client_id ? (clientName.get(campaign.client_id) ?? null) : null,
          dueAt: d.due_at,
          waitingSince: since,
          hours: Math.round(own.reduce((s, t) => s + (t.sla_hours == null ? 0 : Number(t.sla_hours)), 0) * 10) / 10,
          tasks: own.map(toTask),
        })
      }
      return out
    },
  })
}

/** A task of the piece the booking window lists (unbooked) or waits on (any live task). */
export interface PieceTask {
  id: string
  title: string
  hours: number | null
  sortOrder: number | null
  assigneeId: string | null
  assigneeName: string | null
  startsAt: string | null
  dueAt: string | null
  status: string
  workflowStepId: string | null
}

/** Every live task of a piece, in the workflow's order (ADR-0052 d.14). */
export function usePieceTasks(deliverableId: string | null) {
  return useQuery({
    queryKey: bookKeys.pieceTasks(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PieceTask[]> => {
      const { data, error } = await supabaseUntyped
        .from('sub_tasks')
        .select('id, title, sla_hours, sort_order, unit_index, assignee_id, starts_at, due_at, status, workflow_step_id, created_at')
        .eq('deliverable_id', deliverableId!)
        .neq('status', 'cancelled')
        .order('sort_order', { ascending: true, nullsFirst: false })
        // a step's units share its position: unit 1, 2, 3 … (I74.33)
        .order('unit_index', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (data ?? []) as {
        id: string; title: string; sla_hours: number | string | null; sort_order: number | null; assignee_id: string | null
        starts_at: string | null; due_at: string | null; status: string; workflow_step_id: string | null
      }[]
      const people = [...new Set(rows.map((r) => r.assignee_id).filter((x): x is string => !!x))]
      const names = new Map<string, string>()
      if (people.length) {
        const { data: profiles } = await supabaseUntyped.from('user_profiles').select('id, display_name').in('id', people)
        for (const p of (profiles ?? []) as { id: string; display_name: string }[]) names.set(p.id, p.display_name)
      }
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        hours: r.sla_hours == null ? null : Number(r.sla_hours),
        sortOrder: r.sort_order,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
        startsAt: r.starts_at,
        dueAt: r.due_at,
        status: r.status,
        workflowStepId: r.workflow_step_id,
      }))
    },
  })
}

/** A step of the piece's workflow — what "+ Add a task" offers first (SC-11). */
export interface WorkflowStep { id: string; title: string; titleAr: string | null; hours: number | null; sortOrder: number }

export interface PieceWorkflow { name: string | null; nameAr: string | null; steps: WorkflowStep[] }

export function usePieceWorkflow(deliverableId: string | null) {
  return useQuery({
    queryKey: bookKeys.steps(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PieceWorkflow> => {
      const { data: d, error } = await supabaseUntyped.from('deliverables').select('deliverable_type_id').eq('id', deliverableId!).maybeSingle()
      if (error) throw error
      const typeId = (d as { deliverable_type_id: string | null } | null)?.deliverable_type_id
      if (!typeId) return { name: null, nameAr: null, steps: [] }
      const { data: type } = await supabaseUntyped.from('deliverable_types').select('name_en, name_ar, default_workflow_template_id').eq('id', typeId).maybeSingle()
      const tr = type as { name_en: string; name_ar: string | null; default_workflow_template_id: string | null } | null
      if (!tr?.default_workflow_template_id) return { name: tr?.name_en ?? null, nameAr: tr?.name_ar ?? null, steps: [] }
      const { data: steps, error: stepErr } = await supabaseUntyped
        .from('workflow_steps')
        .select('id, title_en, title_ar, default_hours, sort_order')
        .eq('template_id', tr.default_workflow_template_id)
        .eq('is_active', true)
        .order('sort_order')
      if (stepErr) throw stepErr
      return {
        name: tr.name_en,
        nameAr: tr.name_ar,
        steps: ((steps ?? []) as { id: string; title_en: string; title_ar: string | null; default_hours: number | string | null; sort_order: number }[]).map((s) => ({
          id: s.id, title: s.title_en, titleAr: s.title_ar, hours: s.default_hours == null ? null : Number(s.default_hours), sortOrder: s.sort_order,
        })),
      }
    },
  })
}

/** The piece's brief as the booking window shows it (SC-07): the piece's own lines, read only. */
export interface PieceBrief {
  name: string
  code: string | null
  typeName: string | null
  typeNameAr: string | null
  channel: string | null
  format: string | null
  /** ADR-0117 addendum (Q18): the deliverable's languages, in the order chosen. */
  languages: string[]
  orientation: string | null
  quantity: number
  notes: string | null
  contentIdea: string | null
  dueAt: string | null
  campaignId: string | null
  campaignName: string | null
  clientName: string | null
  accountManagerId: string | null
  accountManagerName: string | null
  approvedAt: string | null
}

export function usePieceBrief(deliverableId: string | null) {
  return useQuery({
    queryKey: bookKeys.brief(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PieceBrief | null> => {
      const { data, error } = await supabaseUntyped
        .from('deliverables')
        .select('name, code, channel, format, languages, orientation, quantity, notes, content_idea, due_at, deliverable_type_id, stream_id')
        .eq('id', deliverableId!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const d = data as {
        name: string; code: string | null; channel: string | null; format: string | null; languages: string[] | null; orientation: string | null
        quantity: number | null; notes: string | null; content_idea: string | null; due_at: string | null; deliverable_type_id: string | null; stream_id: string | null
      }
      const [type, stream] = await Promise.all([
        d.deliverable_type_id ? supabaseUntyped.from('deliverable_types').select('name_en, name_ar').eq('id', d.deliverable_type_id).maybeSingle() : Promise.resolve({ data: null }),
        d.stream_id ? supabaseUntyped.from('streams').select('campaign_id').eq('id', d.stream_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const campaignId = (stream.data as { campaign_id: string } | null)?.campaign_id ?? null
      type CampaignBits = { name: string; client_id: string | null; account_manager_id: string | null; approved_at: string | null }
      const campaign: CampaignBits | null = campaignId
        ? ((await supabaseUntyped.from('campaigns').select('name, client_id, account_manager_id, approved_at').eq('id', campaignId).maybeSingle()).data as CampaignBits | null)
        : null
      const [client, am] = await Promise.all([
        campaign?.client_id ? supabaseUntyped.from('clients').select('name').eq('id', campaign.client_id).maybeSingle() : Promise.resolve({ data: null }),
        campaign?.account_manager_id ? supabaseUntyped.from('user_profiles').select('display_name').eq('id', campaign.account_manager_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const t = type.data as { name_en: string; name_ar: string | null } | null
      return {
        name: d.name,
        code: d.code,
        typeName: t?.name_en ?? null,
        typeNameAr: t?.name_ar ?? null,
        channel: d.channel,
        format: d.format,
        languages: d.languages ?? [],
        orientation: d.orientation,
        quantity: d.quantity ?? 1,
        notes: d.notes,
        contentIdea: d.content_idea,
        dueAt: d.due_at,
        campaignId,
        campaignName: campaign?.name ?? null,
        clientName: (client.data as { name: string } | null)?.name ?? null,
        accountManagerId: campaign?.account_manager_id ?? null,
        accountManagerName: (am.data as { display_name: string } | null)?.display_name ?? null,
        approvedAt: campaign?.approved_at ?? null,
      }
    },
  })
}

/** A file or link in the piece's own Library folder (ADR-0134 d.22) — where the team's working files go. */
export interface PieceFile {
  id: string
  name: string
  contentType: string | null
  sizeBytes: number | null
  linkUrl: string | null
  uploadedByName: string | null
  createdAt: string
}

export interface PieceFiles { folderId: string; clientId: string; path: string; files: PieceFile[] }

export function usePieceFiles(deliverableId: string | null) {
  return useQuery({
    queryKey: bookKeys.files(deliverableId ?? 'none'),
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<PieceFiles | null> => {
      const { data, error } = await supabaseUntyped
        .from('asset_folders')
        .select('id, name, client_id')
        .eq('deliverable_id', deliverableId!)
        .eq('kind', 'deliverable')
        .maybeSingle()
      // No folder (a piece outside a campaign): nothing to list, and the tab says so.
      if (error || !data) return null
      const row = data as { id: string; name: string; client_id: string }
      const { data: screen, error: screenErr } = await supabaseUntyped.rpc('library_folder', { p_folder: row.id })
      if (screenErr) throw screenErr
      const s = screen as { chain?: { name: string }[]; files?: Record<string, unknown>[] } | null
      const chain = (s?.chain ?? []).map((c) => c.name)
      const path = chain.length ? (chain[chain.length - 1] === row.name ? chain.join(' / ') : [...chain, row.name].join(' / ')) : row.name
      return {
        folderId: row.id,
        clientId: row.client_id,
        path,
        files: (s?.files ?? []).map((f) => ({
          id: String(f.id),
          name: String(f.name ?? ''),
          contentType: (f.content_type as string | null) ?? null,
          sizeBytes: f.size_bytes == null ? null : Number(f.size_bytes),
          linkUrl: (f.link_url as string | null) ?? null,
          uploadedByName: (f.uploaded_by_name as string | null) ?? null,
          createdAt: String(f.created_at ?? ''),
        })),
      }
    },
  })
}

/** "Add a link" (SC-09) — through the Library's own RPC, so its rules (a name, a real address) hold. */
export function useAddPieceLink(deliverableId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { folderId: string; name: string; url: string }) => {
      const { error } = await supabaseUntyped.rpc('library_add_link', { p_folder: a.folderId, p_name: a.name, p_url: a.url, p_expires_on: null })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bookKeys.files(deliverableId) })
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

/**
 * Who checks the work, for the booking window: the piece's own reviewer (`deliverables.reviewer_id`)
 * and which of its tasks already have one. A task cannot be given out with nobody to check it (the
 * required-reviewer rule, ADR-0038/0089), so a task with none takes the window's reviewer when booked.
 */
export function usePieceReviewers(deliverableId: string | null, taskIds: readonly string[]) {
  return useQuery({
    queryKey: [...scheduleKeys.all, 'piece-reviewers', deliverableId ?? 'none', [...taskIds].sort().join(',')] as const,
    enabled: Boolean(deliverableId),
    queryFn: async (): Promise<{ pieceReviewerId: string | null; withReviewer: Set<string> }> => {
      const { data: d } = await supabaseUntyped.from('deliverables').select('reviewer_id').eq('id', deliverableId!).maybeSingle()
      const rows = taskIds.length
        ? await inChunks<{ sub_task_id: string }>([...taskIds], (chunk) => supabaseUntyped.from('sub_task_reviewers').select('sub_task_id').in('sub_task_id', chunk))
        : []
      return {
        pieceReviewerId: (d as { reviewer_id: string | null } | null)?.reviewer_id ?? null,
        withReviewer: new Set(rows.map((r) => r.sub_task_id)),
      }
    },
  })
}

/**
 * Block time (I74.25, Figma L SC-22 less Amend — ADR-0142 d.4): leave (whole days, the leave policy —
 * `leave:manage` over the person's own lead's reach, unchanged) or internal work (what for, and the
 * hours it takes — counted in the person's day, `blackouts:manage`). Written as the leave page writes
 * it: UTC days, the grid's own columns.
 */
export interface BlockTimeArgs {
  tenantId: string
  resourceId: string
  kind: 'leave' | 'internal'
  /** first and last ISO day */
  from: string
  to: string
  /** internal only */
  hours: number | null
  reason: string | null
}

export function useBlockTime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: BlockTimeArgs) => {
      const { error } = await supabaseUntyped.from('resource_unavailability').insert({
        tenant_id: a.tenantId,
        resource_id: a.resourceId,
        kind: a.kind,
        category: a.kind === 'leave' ? 'planned' : null,
        starts_at: `${a.from}T00:00:00Z`,
        ends_at: `${a.to}T23:59:59Z`,
        hours: a.kind === 'internal' ? a.hours : null,
        reason: a.reason?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      void qc.invalidateQueries({ queryKey: ['leave'] })
      void qc.invalidateQueries({ queryKey: ['team'] })
    },
  })
}

/**
 * Undo, from the toast after booking (SC-18): the tasks just given out go back to To book
 * (`unassign_task`, ADR-0140 d.5 — the assignee and their lead are told) and the asks just sent are
 * withdrawn. Each is its own server act; what cannot be undone says why.
 */
export function useUndoBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { subTaskIds: string[]; requestIds: string[] }) => {
      const failures: unknown[] = []
      for (const id of a.subTaskIds) {
        const { error } = await supabaseUntyped.rpc('unassign_task', { p_sub_task: id, p_confirm_started: false })
        if (error) failures.push(error)
      }
      for (const id of a.requestIds) {
        const { error } = await supabaseUntyped.rpc('withdraw_assignment_request', { p_request: id })
        if (error) failures.push(error)
      }
      if (failures.length) throw failures[0]
    },
    onSettled: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: ['task-asks'] })
    },
  })
}
