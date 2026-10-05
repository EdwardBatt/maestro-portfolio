import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { taxonomyKeys } from './deliverable-types-api'
import { toReviewMode, type ReviewMode } from '../../../lib/review/review-mode'

/**
 * Workflow templates as tenant data (ADR-0052, I19.11/I19.12).
 *
 * **Why this file exists at all.** The 14 templates and their 154 steps have been in the database
 * since 28 Aug and nothing in `src/` has ever read them. `deliverable_types.default_workflow_template_id`
 * — the single field that tells `app.materialise_deliverable_workflow` which template a type
 * implies — was created, given a foreign key, and read by the engine, but no seed, migration or
 * screen ever wrote a value into it. Every one of the 240 types held null, so setting a type on a
 * deliverable materialised nothing, and the whole of I19 was inert in production.
 *
 * pgTAP `065` did not catch it because its own fixture sets that field before exercising the
 * engine: the suite asked "does the materialiser work when a type has a template?" and never
 * "can a type ever get one?".
 *
 * A template names WORK — "Storyboard", "Rough Cut", "Prepress" — and never a person, department,
 * team or role (ADR-0052 d.1). That is the discipline that makes seeding these safe where seeding
 * `work_types` was not: who does the work is derived from whoever a human assigns, at the moment
 * they assign them.
 *
 * Writes need `organization:manage`, enforced by RLS on both tables; the surface only decides
 * whether to offer the attempt.
 */

export interface WorkflowTemplate {
  id: string
  code: string
  nameEn: string
  nameAr: string | null
  descriptionEn: string | null
  descriptionAr: string | null
  /** A seeded row. The surface warns before editing one — a later seed refresh finds its own rows
   *  by this flag, and a tenant that renames one should know that. */
  isSystem: boolean
  isActive: boolean
}

export interface WorkflowStep {
  id: string
  templateId: string
  sortOrder: number
  titleEn: string
  titleAr: string | null
  /** ADR-0052 d.4: an ESTIMATE offered as a prefill when the owner assigns the task. It is
   *  deliberately never written into `sub_tasks.sla_hours`, which is tier 1 of `app.effective_sla`
   *  and would short-circuit every tier beneath it on every materialised task. */
  defaultHours: number | null
  /** ADR-0059 d.2: what this KIND of work usually needs — the default the materialiser stamps onto
   *  each task made from this step. A proposal, not an authority: the task's own mode is what the
   *  submit gate reads, and editing this never reaches work already under way. */
  reviewMode: ReviewMode
  /** ADR-0071 d.8: the creation step — one task per unit of the deliverable's quantity. Absent = false. */
  repeatsPerUnit?: boolean
  isActive: boolean
}

export const workflowKeys = {
  all: ['workflow-templates'] as const,
  templates: () => [...workflowKeys.all, 'templates'] as const,
  steps: () => [...workflowKeys.all, 'steps'] as const,
}

/**
 * Every template, active and not — the Admin screen shows both, because a deactivated template
 * still has to be findable to be reactivated. Pickers filter to active themselves.
 */
export function useWorkflowTemplates() {
  return useQuery({
    queryKey: workflowKeys.templates(),
    queryFn: async (): Promise<WorkflowTemplate[]> => {
      const { data, error } = await supabaseUntyped
        .from('workflow_templates')
        .select('id, code, name_en, name_ar, description_en, description_ar, is_system, is_active')
        .order('code')
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        code: r.code as string,
        nameEn: r.name_en as string,
        nameAr: (r.name_ar as string | null) ?? null,
        descriptionEn: (r.description_en as string | null) ?? null,
        descriptionAr: (r.description_ar as string | null) ?? null,
        isSystem: r.is_system as boolean,
        isActive: r.is_active as boolean,
      }))
    },
  })
}

/** Every step of every template, ordered. One read: 154 rows is smaller than 14 round trips. */
export function useWorkflowSteps() {
  return useQuery({
    queryKey: workflowKeys.steps(),
    queryFn: async (): Promise<WorkflowStep[]> => {
      const { data, error } = await supabaseUntyped
        .from('workflow_steps')
        .select('id, template_id, sort_order, title_en, title_ar, default_hours, review_mode, repeats_per_unit, is_active')
        .order('template_id')
        .order('sort_order')
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        templateId: r.template_id as string,
        sortOrder: r.sort_order as number,
        titleEn: r.title_en as string,
        titleAr: (r.title_ar as string | null) ?? null,
        defaultHours: (r.default_hours as number | null) ?? null,
        reviewMode: toReviewMode(r.review_mode),
        repeatsPerUnit: r.repeats_per_unit === true,
        isActive: r.is_active as boolean,
      }))
    },
  })
}

export function useSaveWorkflowTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: { id: string } & Partial<WorkflowTemplate>) => {
      // Named uniquely per function ON PURPOSE. `src/test/postgrest-selects.test.ts` reads these
      // payloads statically to check every key against the generated schema, and two payloads
      // sharing a name in one file makes both unreadable — so they get silently skipped, which is
      // the exact blind spot that suite exists to close.
      const templatePatch: Record<string, unknown> = {}
      if (t.nameEn !== undefined) templatePatch.name_en = t.nameEn.trim()
      if (t.nameAr !== undefined) templatePatch.name_ar = t.nameAr?.trim() || null
      if (t.descriptionEn !== undefined) templatePatch.description_en = t.descriptionEn?.trim() || null
      if (t.descriptionAr !== undefined) templatePatch.description_ar = t.descriptionAr?.trim() || null
      if (t.isActive !== undefined) templatePatch.is_active = t.isActive
      const { error } = await supabaseUntyped.from('workflow_templates').update(templatePatch).eq('id', t.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

export function useCreateWorkflowTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: { code: string; nameEn: string; nameAr: string | null; tenantId: string }) => {
      const { error } = await supabaseUntyped.from('workflow_templates').insert({
        tenant_id: t.tenantId,
        code: t.code.trim().toUpperCase(),
        name_en: t.nameEn.trim(),
        name_ar: t.nameAr?.trim() || null,
        // Never `is_system`: that flag marks a row the seed owns, and a tenant's own template is
        // not one. Leaving it default false is what keeps a seed refresh off this row.
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

export function useSaveWorkflowStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: { id: string } & Partial<WorkflowStep>) => {
      const stepPatch: Record<string, unknown> = {}
      if (s.titleEn !== undefined) stepPatch.title_en = s.titleEn.trim()
      if (s.titleAr !== undefined) stepPatch.title_ar = s.titleAr?.trim() || null
      if (s.defaultHours !== undefined) stepPatch.default_hours = s.defaultHours
      if (s.reviewMode !== undefined) stepPatch.review_mode = s.reviewMode
      if (s.isActive !== undefined) stepPatch.is_active = s.isActive
      if (s.sortOrder !== undefined) stepPatch.sort_order = s.sortOrder
      const { error } = await supabaseUntyped.from('workflow_steps').update(stepPatch).eq('id', s.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

export function useCreateWorkflowStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: {
      tenantId: string
      templateId: string
      sortOrder: number
      titleEn: string
      titleAr: string | null
      defaultHours: number | null
      reviewMode: ReviewMode
    }) => {
      const { error } = await supabaseUntyped.from('workflow_steps').insert({
        tenant_id: s.tenantId,
        template_id: s.templateId,
        sort_order: s.sortOrder,
        title_en: s.titleEn.trim(),
        title_ar: s.titleAr?.trim() || null,
        default_hours: s.defaultHours,
        review_mode: s.reviewMode,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

/**
 * Remove a step from a template outright.
 *
 * Edward, 29 Aug: *"we can add steps but not remove them… to make this truly customisable we
 * should be able to edit the workflow templates."* Deactivating was the wrong tool here. A
 * deactivated step still occupies a position in a list somebody is reading, and a template is a
 * plan rather than a record — nothing happened to it, so there is nothing to preserve.
 *
 * Safe by construction: `sub_tasks.workflow_step_id` is `on delete set null`
 * (`20260828190000:121`), so a task already materialised from this step keeps its title, its
 * assignee, its history and its review — it simply stops pointing at a template row. Deleting a
 * step edits the PLAN and never touches work in flight.
 */
export function useDeleteWorkflowStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (stepId: string) => {
      const { error } = await supabaseUntyped.from('workflow_steps').delete().eq('id', stepId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

/**
 * Reorder a template's steps.
 *
 * `uq_workflow_steps_tenant_template_order` makes `(tenant, template, sort_order)` unique, so two
 * steps may not hold the same position even momentarily. PostgREST puts every request in its own
 * transaction, so a straight swap collides. The steps are therefore parked in a high range first
 * and written down into their final positions second — two passes, no collision, and no migration
 * needed for what is a presentation change.
 *
 * Like the deliverable task list (ADR-0052 d.14), this moves a NUMBER. Nothing is scheduled from a
 * template, so there are no dates here to protect — but the same rule holds one level down, and
 * saying so here is what stops somebody adding date arithmetic to a reorder later.
 */
export function useResequenceWorkflowSteps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { orderedIds: string[] }) => {
      const PARK = 1000
      for (let i = 0; i < args.orderedIds.length; i++) {
        const { error } = await supabaseUntyped
          .from('workflow_steps')
          .update({ sort_order: PARK + i })
          .eq('id', args.orderedIds[i])
        if (error) throw error
      }
      for (let i = 0; i < args.orderedIds.length; i++) {
        const { error } = await supabaseUntyped
          .from('workflow_steps')
          .update({ sort_order: i + 1 })
          .eq('id', args.orderedIds[i])
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowKeys.all }),
  })
}

/**
 * Point a deliverable type at a template — the field that was missing.
 *
 * This is the join the whole of I19 hangs on: `app.materialise_deliverable_workflow` reads
 * `deliverable_types.default_workflow_template_id`, and until something could write it, setting a
 * type on a deliverable created no tasks at all.
 *
 * Invalidates the taxonomy keys as well as its own, because the Deliverable Types screen renders
 * the value and would otherwise show the old one until a refresh.
 */
export function useSetTypeWorkflowTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { typeId: string; templateId: string | null }) => {
      const { error } = await supabaseUntyped
        .from('deliverable_types')
        .update({ default_workflow_template_id: args.templateId })
        .eq('id', args.typeId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.all })
      void qc.invalidateQueries({ queryKey: taxonomyKeys.types })
    },
  })
}
