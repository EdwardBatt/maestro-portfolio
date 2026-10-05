import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { PAGE_ROWS, restPages } from '../../../lib/query/all-pages'
import { adminKeys } from '../../admin/api/admin-api'
import { useInvalidateFolders } from '../../../lib/assets/folders'

/**
 * Campaign Builder / Brief Wizard (ADR-0020, frames 21.1–21.5). Reads the
 * reference data the wizard needs (clients, brands, disciplines) and submits a
 * finished brief. Submit is a single RLS-governed RPC
 * (public.create_campaign_from_brief) that writes campaign → stream-per-discipline
 * → deliverables atomically — see the migration for why it isn't three client
 * inserts. Clients/brands are registered in Admin → Organization (Phase A).
 */

export const campaignKeys = {
  all: ['campaigns'] as const,
  list: () => [...campaignKeys.all, 'list'] as const,
  refData: () => [...campaignKeys.all, 'ref-data'] as const,
  draft: (id: string) => [...campaignKeys.all, 'draft', id] as const,
}

// ---- Reference data (client picker, brand picker) ----

export interface ClientOption {
  id: string
  name: string
  /** Their account manager, which pre-fills the campaign's. Null is common and legal. */
  accountManagerId: string | null
}
export interface BrandOption {
  id: string
  name: string
  clientId: string
}
export interface WizardRefData {
  clients: ClientOption[]
  brands: BrandOption[]
}

export function useWizardRefData() {
  return useQuery({
    queryKey: campaignKeys.refData(),
    queryFn: async (): Promise<WizardRefData> => {
      // I21 (ADR-0056 d.14): the third query read `work_types` for a discipline picker ADR-0050
      // replaced with an owner picker. Nothing had consumed `disciplines` since — but it shared this
      // `Promise.all`, so the dead read was still able to throw the whole query and leave the Brief
      // Wizard showing its failure state with nobody able to create a campaign.
      const [clientsRes, brandsRes] = await Promise.all([
        // The client's account manager comes with the client: it is the DEFAULT for the
        // campaign's, and approval falls back to it when the campaign names nobody.
        // A draft client is never offered (ADR-0123 d.2) — the database refuses work for one too.
        supabaseUntyped.from('clients').select('id, name, account_manager_id').eq('status', 'active').order('name'),
        supabaseUntyped.from('brands').select('id, name, client_id').order('name'),
      ])
      if (clientsRes.error) throw clientsRes.error
      if (brandsRes.error) throw brandsRes.error
      const clients = ((clientsRes.data ?? []) as { id: string; name: string; account_manager_id: string | null }[])
        .map((c) => ({ id: c.id, name: c.name, accountManagerId: c.account_manager_id ?? null }))
      const brands = ((brandsRes.data ?? []) as { id: string; name: string; client_id: string }[]).map(
        (b) => ({ id: b.id, name: b.name, clientId: b.client_id }),
      )
      return { clients, brands }
    },
  })
}

// ---- Campaign list (the Client Services working surface) ----

export interface CampaignListRow {
  id: string
  name: string
  clientName: string
  brandName: string | null
  goLiveAt: string | null
  /** ADR-0067: `draft` is a wizard somebody walked away from, not a campaign. */
  status: CampaignStatus
  /** I40.21 — who to chase. */
  accountManagerName: string | null
  /** I40.21 — department briefs COUNTED, so the list says "1 of 2 approved" without listing them. */
  departmentBriefTotal: number
  departmentBriefApproved: number
  /** I40.21 — the people with work on this campaign, by name. */
  briefOwnerNames: string[]
  /** I48: deliverables on the campaign, and how many have an approved task list (ADR-0090). For a
   *  single job the list reads these — not the brief's approved_at — to say whether it is done. */
  deliverableTotal: number
  deliverableTasksApproved: number
  /** ADR-0086 d.8: a stored fact, never inferred. `campaign` for every row written before it existed. */
  kind: 'single_job' | 'campaign'
  /** I51.1: who started it and when, who last touched it and when. Names are null where the log
   *  never saw the row (seeded before the audit trigger, or written by a service role). */
  createdAt: string | null
  updatedAt: string | null
  createdByName: string | null
  updatedByName: string | null
}

export type CampaignStatus = 'draft' | 'pending_approval' | 'approved' | 'closed'

/**
 * The Client Services working surface (I40.21).
 *
 * Reads `campaign_list_rows`, a SECURITY INVOKER view, rather than assembling this here. Two
 * reasons, both structural: the owners would otherwise need `department_brief_approvers` once per
 * campaign — N+1 down the list — and the equivalent embed nests four levels through `deliverables`,
 * which reaches `user_profiles` by two foreign keys and so is refused as ambiguous unless every
 * constraint is named. Shaping it in SQL removes both.
 */
export function useCampaignList() {
  return useQuery({
    queryKey: campaignKeys.list(),
    queryFn: async (): Promise<CampaignListRow[]> => {
      // Every column, because `kind` (ADR-0086 d.8) is the view's newest and the static select guard
      // cannot see the migration that adds it until the types regenerate. Narrow this back then.
      // EVERY campaign, not PostgREST's first 1000 (lib/query/all-pages.ts): past a thousand the list
      // silently lost its last rows — the ones with no go-live yet, i.e. a pending job waiting for
      // Continue (25 Sep, 1,056 campaigns). `id` breaks go-live ties so the pages neither overlap nor skip.
      const page = (from: number, to: number, withCount = false) =>
        supabaseUntyped
          .from('campaign_list_rows')
          .select('*', withCount ? { count: 'exact' } : undefined)
          .order('go_live_at', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to)
      const { data: firstPage, error, count } = await page(0, PAGE_ROWS - 1, true)
      if (error) throw error
      const raw = [...(firstPage ?? []), ...(await restPages(count ?? 0, (a, b) => page(a, b)))]
      const rows = raw as unknown as {
        id: string
        name: string
        status: CampaignStatus
        go_live_at: string | null
        client_name: string | null
        brand_name: string | null
        account_manager_name: string | null
        department_brief_total: number | null
        department_brief_approved: number | null
        brief_owner_names: string[] | null
        deliverable_total: number | null
        deliverable_tasks_approved: number | null
        kind?: unknown
        created_at?: string | null
        updated_at?: string | null
        created_by_name?: string | null
        updated_by_name?: string | null
      }[]
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        clientName: c.client_name ?? '',
        brandName: c.brand_name,
        goLiveAt: c.go_live_at,
        status: c.status,
        accountManagerName: c.account_manager_name,
        departmentBriefTotal: c.department_brief_total ?? 0,
        departmentBriefApproved: c.department_brief_approved ?? 0,
        briefOwnerNames: c.brief_owner_names ?? [],
        deliverableTotal: c.deliverable_total ?? 0,
        deliverableTasksApproved: c.deliverable_tasks_approved ?? 0,
        kind: c.kind === 'single_job' ? 'single_job' : 'campaign',
        createdAt: c.created_at ?? null,
        updatedAt: c.updated_at ?? null,
        createdByName: c.created_by_name ?? null,
        updatedByName: c.updated_by_name ?? null,
      }))
    },
  })
}

// ---- Submit ----

/** The nine strategy fields (frame 21.2) plus the chosen brief type. Stored whole
 *  as campaigns.brief; audience/insight/proposition are mirrored to real columns. */
export interface BriefStrategy {
  /** ADR-0050 d.5: there is no campaign-level brief type. Kept optional only so an existing
   *  campaign whose stored brief still carries one round-trips without losing it. */
  briefType?: string
  background: string
  task: string
  beautifulProblem: string
  audiencePrimary: string
  audienceSecondary: string
  brandFunctionalBenefit: string
  brandEmotionalBenefit: string
  insight: string
  proposition: string
}

export interface BriefDeliverable {
  name: string
  /** ADR-0051 d.7: nullable forever — an untyped deliverable is legal and never blocks the wizard. */
  deliverableTypeId: string | null
  /** ADR-0051 d.9: the CODE of a deliverable_attribute_values row, not an id. */
  channel: string | null
  format: string | null
  /** ADR-0050 d.1: the person accountable. Department follows from them (d.2). */
  ownerUserId: string
  quantity: number
  commenceAt: string | null
  dueAt: string | null
  /**
   * I41.8 (ADR-0075 d.9): the person was shown a tight/impossible warning on this due date and
   * proceeded. Travels inside the deliverable JSON so the database records it against the row in
   * the same statement that creates it. Absent when the date drew no warning.
   */
  dueDateOverride?: DueDateOverride | null
  /** ADR-0096 d.8: which phase, by NUMBER (the wizard's phases are not rows yet). Required when
   *  the campaign runs in phases; ignored otherwise. */
  phaseNumber?: number | null
  /**
   * I56.3 (ADR-0099 d.1): which group holds it, by the WIZARD'S OWN draft id — the `key` of an
   * entry in `workstreams`, not a uuid, because the rows do not exist until submit. Absent or
   * null means ungrouped, which is legal and permanent; a key naming no entry is refused.
   *
   * The department is NOT sent with it: the group stamps it on the way in (d.3), in one place.
   */
  workstreamKey?: string | null
  /** I56.8 (CB-v3-P4): the line the creative reads first. */
  contentIdea?: string | null
  /** I56.8: the account manager's own aside. Distinct from the brief's words about the row
   *  (ADR-0097 d.2), which are evidence and are never overwritten by a person. */
  notes?: string | null
  /** I56.7: the ONE language this piece ships in, by the `deliverable_attribute_values` CODE.
   *  Several languages is several pieces. */
  language?: string | null
  /** SJ-v3-04 / I54.15: exactly what `chk_deliverables_priority` accepts — nothing else. */
  priority?: 'high' | 'medium' | 'low' | null
  /** I56.11 (Q4): the due date has been told to the client. A marker only. */
  isGivenToClient?: boolean
}

export interface DueDateOverride {
  severity: 'tight' | 'impossible' | 'after_go_live' | 'after_phase_end'
  workingDaysLeft: number
  requiredDays: number
  outstandingHours?: number | null
  capacityHours?: number | null
  /** ADR-0096 d.7: which line was crossed. Absent means go-live. */
  boundary?: 'go_live' | 'phase_end'
}

/** ADR-0096 d.2: a phase as the wizard holds it — numbered by position, named, dated. */
export interface BriefPhase {
  name: string
  /** `YYYY-MM-DD` */
  startsOn: string
  endsOn: string
  /** I56.10 (CB-v3-P1): the real-world event the phase is aimed at — "Draw Night 2". Absent
   *  where the phase simply ends on its date; the timing step then reads the date instead. */
  endsOnEvent?: string | null
}

/**
 * I56.3 (ADR-0099): a workstream as the wizard holds it, before the campaign exists.
 *
 * `key` is the wizard's OWN draft id — any stable string, not a uuid, because nothing has been
 * written yet. Deliverables name their group by the same key and the RPC resolves both inside
 * one statement, so a campaign and its groups are created together or not at all.
 *
 * The department is required (d.3): it is what the group sets on the work inside it. The owner
 * is optional (d.5).
 */
export interface BriefWorkstream {
  key: string
  name: string
  departmentId: string
  ownerUserId?: string | null
  /** I59.54: letters the person typed when making it; absent, the database uses the rule's. */
  codeLetters?: string
}

/** Performance-marketing brief fields (ADR-0021), captured only for the paid_media
 *  brief type. Audience/geography/platforms are campaign-level (never client
 *  defaults). Stored inside campaigns.brief.performance. */
export interface PerformanceBrief {
  objective: string
  budget: string
  audience: string
  geography: string
  platforms: string
}

export interface BriefSubmit {
  clientId: string
  brandId: string | null
  name: string
  /** Who approves this campaign. Null falls back to the client's, which is the ordinary case. */
  accountManagerId: string | null
  goLiveAt: string | null
  strategy: BriefStrategy
  performance: PerformanceBrief | null
  deliverables: BriefDeliverable[]
  /** ADR-0096 d.8: the Phases step. Empty or absent means the campaign does not run in phases. */
  phases?: BriefPhase[]
  /** I56.3 (ADR-0099 d.1): the work screen's groups. Empty or absent means the campaign has
   *  none, which is normal and permanent — every deliverable is then ungrouped. */
  workstreams?: BriefWorkstream[]
  /** ADR-0117 d.1: the languages the campaign is made in — `language` codes, in the order chosen. */
  languages?: string[]
  /** I56.6: the campaign's own dos and don'ts; its client's stay on the client's profile. */
  rules?: { kind: 'do' | 'dont'; text: string }[]
}

/** The phases as `write_campaign_content` wants them: numbered by position. Null when there are none. */
function phasePayload(phases: BriefPhase[] | undefined) {
  if (!phases || phases.length === 0) return null
  return phases.map((p, i) => ({
    number: i + 1,
    name: p.name.trim(),
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    // I56.10: only when there is one. An absent key and a null read the same to the RPC, and an
    // absent one keeps a phase written before section C byte-identical.
    ...(p.endsOnEvent ? { endsOnEvent: p.endsOnEvent } : {}),
  }))
}

/** I56.3: the groups as `write_campaign_content` wants them — the wizard's own draft ids as
 *  keys, resolved to rows inside the one statement that creates the campaign. Null when there
 *  are none, which is how a campaign with no groups is said. */
function workstreamPayload(workstreams: BriefWorkstream[] | undefined) {
  if (!workstreams || workstreams.length === 0) return null
  return workstreams.map((w) => ({
    key: w.key,
    name: w.name.trim(),
    departmentId: w.departmentId,
    ownerUserId: w.ownerUserId ?? null,
    ...(w.codeLetters ? { codeLetters: w.codeLetters } : {}),
  }))
}

/** The five fields section C added to a piece, present only where the wizard actually collected
 *  one — so a payload that knows none of them is identical to what was sent before (I56.3). */
function sectionCFields(d: BriefDeliverable) {
  return {
    ...(d.workstreamKey ? { workstreamKey: d.workstreamKey } : {}),
    ...(d.contentIdea ? { contentIdea: d.contentIdea } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ...(d.language ? { language: d.language } : {}),
    ...(d.priority ? { priority: d.priority } : {}),
    ...(d.isGivenToClient ? { isGivenToClient: true } : {}),
  }
}

/**
 * The two payloads a submit builds, extracted at ADR-0067 so the one-shot path and the
 * draft-completion path cannot disagree about them — the same reason the migration factored
 * `app.write_campaign_content` out of the two RPCs.
 *
 * The brief jsonb carries the FULL deliverable spec because the `deliverables` table is
 * deliberately minimal; the row payload carries what ADR-0051 I18.5 moved onto the row itself.
 * They overlap, and that overlap is intentional, not duplication to tidy away.
 */
function briefPayload(input: {
  strategy: BriefStrategy
  performance: PerformanceBrief | null
  deliverables: BriefDeliverable[]
  phases?: BriefPhase[]
  workstreams?: BriefWorkstream[]
  languages?: string[]
  rules?: { kind: 'do' | 'dont'; text: string }[]
}) {
  return {
    ...input.strategy,
    performance: input.performance,
    // ADR-0117 d.1: `write_campaign_content` writes `campaigns.languages` from this.
    ...(input.languages && input.languages.length > 0 ? { languages: input.languages } : {}),
    // I56.6: stored on the campaign's brief; the task page and the review panel read them from there.
    ...(input.rules && input.rules.length > 0 ? { rules: input.rules } : {}),
    deliverables: input.deliverables.map((d) => ({
      name: d.name.trim(),
      ownerUserId: d.ownerUserId,
      quantity: d.quantity,
      commenceAt: d.commenceAt,
      dueAt: d.dueAt,
      deliverableTypeId: d.deliverableTypeId,
      channel: d.channel,
      format: d.format,
      phaseNumber: d.phaseNumber ?? null,
      // I56.3 / I56.7 / I56.8. Conditional, because the brief jsonb is a stored record: a
      // campaign raised before section C must not start reading as one that was asked these
      // and left them empty.
      ...sectionCFields(d),
    })),
    ...(input.phases && input.phases.length > 0 ? { phases: phasePayload(input.phases) } : {}),
    ...(input.workstreams && input.workstreams.length > 0
      ? { workstreams: workstreamPayload(input.workstreams) }
      : {}),
  }
}

function deliverablePayload(deliverables: BriefDeliverable[]) {
  return deliverables.map((d) => ({
    name: d.name.trim(),
    ownerUserId: d.ownerUserId,
    dueAt: d.dueAt,
    // ADR-0051 I18.5: the specification reaches the ROW, not just the brief jsonb.
    deliverableTypeId: d.deliverableTypeId,
    quantity: d.quantity,
    channel: d.channel,
    format: d.format,
    ...(d.dueDateOverride ? { dueDateOverride: d.dueDateOverride } : {}),
    ...(d.phaseNumber ? { phaseNumber: d.phaseNumber } : {}),
    // I56.3 / I56.7 / I56.8: the group, the idea, the notes, the language and the priority reach
    // the ROW. The department does not — the group stamps it on the way in (ADR-0099 d.3).
    ...sectionCFields(d),
  }))
}

/**
 * Submit a finished brief. Persists the full deliverable spec (quantity, load,
 * commence date) inside the brief jsonb — the deliverables table is intentionally
 * minimal (name/state/due) — and materialises a deliverable row per line so
 * scheduling and the dashboards see them. All in one atomic RPC.
 */
export function useCreateCampaignFromBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BriefSubmit): Promise<string> => {
      const brief = briefPayload(input)
      const { data, error } = await supabaseUntyped.rpc('create_campaign_from_brief', {
        p_client: input.clientId,
        p_brand: input.brandId,
        p_name: input.name.trim(),
        p_brief: brief,
        p_go_live: input.goLiveAt,
        // Approval resolves coalesce(campaign, client); a campaign under a client with no
        // account manager could otherwise be approved by nobody (29 Aug).
        p_account_manager: input.accountManagerId || null,
        p_deliverables: deliverablePayload(input.deliverables),
        p_phases: phasePayload(input.phases),
        p_workstreams: workstreamPayload(input.workstreams),
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all })
      void qc.invalidateQueries({ queryKey: adminKeys.all }) // client campaign counts
    },
  })
}

// ---- The draft campaign (ADR-0067) ----

/**
 * A campaign exists from step 2 of the wizard, because a document needs a folder and a folder
 * needs a campaign. These four wrap the RPCs that migration `20260903100100` added; between them
 * they are the whole life of a draft, and every one of them is refused by the database on a
 * campaign that is no longer one.
 *
 * The wizard's SUBMIT is `useCompleteCampaignDraft`, not `useCreateCampaignFromBrief`. The latter
 * is still the one-shot path and still works — after that migration the two share
 * `app.write_campaign_content`, so the brief, the stream and the deliverable specification have a
 * single implementation and cannot drift.
 */

export interface StartDraft {
  clientId: string
  brandId: string | null
  name: string
  accountManagerId: string | null
}

export function useStartCampaignDraft() {
  const qc = useQueryClient()
  const invalidateFolders = useInvalidateFolders()
  return useMutation({
    mutationFn: async (input: StartDraft): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('start_campaign_draft', {
        p_client: input.clientId,
        p_brand: input.brandId,
        p_name: input.name.trim(),
        p_account_manager: input.accountManagerId || null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (_id, input) => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all })
      // The INSERT provisioned this campaign's folders (Working Files / Deliverables / Final
      // Assets / References). The wizard read the client's tree when the client was picked —
      // BEFORE any of that existed — so without this the step 2 filing panel finds no campaign
      // folder and renders nothing at all. Invalidating here rather than at the call site
      // because provisioning is what this mutation DID, not something a caller should remember.
      void invalidateFolders(input.clientId)
    },
  })
}

export interface UpdateDraft {
  campaignId: string
  brandId: string | null
  name: string
  accountManagerId: string | null
  /**
   * What was typed on steps 2 to 4, shaped exactly as submit sends it (I40). Omitted from a step 1
   * save, where undefined means LEAVE ALONE rather than blank — going back and pressing Next again
   * must not erase a brief that a later step wrote.
   */
  brief?: Record<string, unknown> | null
  goLiveAt?: string | null
}

/**
 * Going back to step 1. The CLIENT is deliberately not here: folders are keyed
 * client → Projects → campaign, so moving a filed campaign to another client is a move rather
 * than a rename, and ADR-0067 does not make it possible. The wizard blocks the change instead.
 */
export function useUpdateCampaignDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateDraft): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('update_campaign_draft', {
        p_campaign: input.campaignId,
        p_brand: input.brandId,
        p_name: input.name.trim(),
        p_account_manager: input.accountManagerId || null,
        // I40 — what was typed on steps 2 to 4. Undefined means "leave it alone", so going BACK to
        // step 1 and pressing Next cannot erase the brief a later step wrote.
        p_brief: input.brief ?? null,
        p_go_live: input.goLiveAt ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: campaignKeys.all }),
  })
}

/** Refused by the database once anything is filed under the draft — the cascade would take the
 *  documents with it (ADR-0067 d.7). Surfaced as `campaign_draft_has_assets`. */
export function useDiscardCampaignDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('discard_campaign_draft', { p_campaign: campaignId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all })
      void qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}

/** ADR-0091 / I48.9: close out a finished campaign. The RPC refuses while work is unfinished and
 *  names the count, so the caller surfaces the server's own message. */
export function useCloseOutCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('close_out_campaign', { p_campaign: campaignId })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: campaignKeys.all }),
  })
}

/** ADR-0091 / I48.9: return a closed campaign to approved. */
export function useReopenCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string): Promise<void> => {
      const { error } = await supabaseUntyped.rpc('reopen_campaign', { p_campaign: campaignId })
      if (error) throw error
    },
    // The page reads under `campaign-detail`, which `campaigns` does not cover (traps.md).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all })
      void qc.invalidateQueries({ queryKey: ['campaign-detail'] })
    },
  })
}

export interface CompleteDraft
  extends Omit<BriefSubmit, 'clientId' | 'brandId' | 'accountManagerId' | 'name'> {
  campaignId: string
}

/** The wizard's submit (ADR-0067 d.4). Refuses a second run, so a double click cannot write a
 *  second stream and a second set of deliverables onto a campaign that is already live. */
export function useCompleteCampaignDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CompleteDraft): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('complete_campaign_draft', {
        p_campaign: input.campaignId,
        p_brief: briefPayload(input),
        p_go_live: input.goLiveAt,
        p_deliverables: deliverablePayload(input.deliverables),
        p_phases: phasePayload(input.phases),
        p_workstreams: workstreamPayload(input.workstreams),
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all })
      void qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}

/**
 * The drafts I started (ADR-0067) — My Work's "Unfinished briefs" and the campaigns list's Mine when it is
 * filtered to them (I66.2). `created_by` is stamped by the database (`app.set_actor`), not by the wizard.
 */
export function useMyDrafts(userId: string | null) {
  return useQuery({
    queryKey: [...campaignKeys.all, 'my-drafts', userId],
    enabled: Boolean(userId),
    refetchInterval: 20_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabaseUntyped
        .from('campaigns')
        .select('id')
        .eq('status', 'draft')
        .eq('created_by', userId!)
      if (error) throw error
      return ((data ?? []) as { id: string }[]).map((r) => r.id)
    },
  })
}

export interface DraftIdentity {
  id: string
  clientId: string
  brandId: string | null
  name: string
  accountManagerId: string | null
  /** Steps 2 to 4 as last saved. Null on a draft written before I40, and on a brand-new one. */
  brief: Record<string, unknown> | null
  goLiveAt: string | null
}

/**
 * Read a draft back, so the wizard can resume one (ADR-0067 d.3).
 *
 * Only its IDENTITY exists to read: a draft has no brief, no stream and no deliverables, because
 * those are written at submit. So resuming restores step 1 and the person carries on — which is
 * exactly what they lost by closing the tab, and no more.
 *
 * Filtered to `draft`, deliberately. Pointing this at a live campaign would let the wizard
 * "resume" something already approved and then try to complete it a second time; the database
 * refuses that (d.4), but returning nothing here is a clearer answer than a refusal later.
 */
export function useCampaignDraft(campaignId: string | null) {
  return useQuery({
    queryKey: campaignKeys.draft(campaignId ?? 'none'),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<DraftIdentity | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaigns')
        // I40: `brief` and `go_live_at` too. Without them a resumed draft restored step 1 and
        // left every later step blank, which is not what ADR-0067 means by "resumable".
        .select('id, client_id, brand_id, name, account_manager_id, brief, go_live_at')
        .eq('id', campaignId!)
        .eq('status', 'draft')
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const c = data as {
        id: string; client_id: string; brand_id: string | null
        name: string; account_manager_id: string | null
        brief: Record<string, unknown> | null; go_live_at: string | null
      }
      return {
        id: c.id,
        clientId: c.client_id,
        brandId: c.brand_id,
        name: c.name,
        accountManagerId: c.account_manager_id,
        brief: c.brief,
        goLiveAt: c.go_live_at,
      }
    },
  })
}
