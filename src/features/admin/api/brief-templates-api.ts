import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'

/**
 * Brief templates (ADR-0048 d.2, I16.1) — what each brief type CONTAINS.
 *
 * Tenant data rather than code, for two reasons the ADR records: the agency's deck will change
 * its wording and a redeploy should not be how that happens; and the four types Edward added
 * had to be authored by a person.
 *
 * **The guidance line is the model's prompt as well as the human's hint.** Editing it changes
 * generated output, which is why the screen says so rather than treating it as copy.
 *
 * **There is no discipline → template mapping here any more.** `useDisciplineMappings` and
 * `useSetDisciplineTemplate` read and wrote `work_types.brief_type`, a column that never existed:
 * ADR-0048 d.5 proposed it and ADR-0050 d.4 superseded the idea before it was built, so both hooks
 * failed with a PostgREST 42703 every time the admin screen opened. The brief type is now chosen
 * per department on `campaign_briefs.brief_type` by the account manager, so nothing needs a map
 * from a discipline to a template. Deleted rather than repaired — the reading ADR-0056 d.12
 * records.
 *
 * **That mapping came back on 30 Aug, in the shape it should always have had.** Which briefs a
 * department MAY use is a many-to-many the tenant sets, and nothing is inferred from a name —
 * Edward: *"this is a multitenant system, so we need to accept not everyone uses the same org
 * structure and names their departments differently."*
 *
 * **Many-to-many in both directions, and both matter.** Two departments share the Social brief; and
 * Creative writes a Creative Brief for a 360 campaign and an Execution Brief for a single banner —
 * *"if I assign Creative Brief to Creative, I cannot assign any other brief to Creative"* was the
 * defect in the first attempt. Which of a department's briefs a given campaign uses is chosen at
 * review, where the deliverables exist and the kind of work is finally knowable.
 */

export interface BriefTemplateField {
  key: string
  en: string
  ar: string
  guidance: string
  multiline?: boolean
  /** SJ-v3-02: one of the template's ESSENTIALS — shown in section 1; the rest in section 2. */
  essential?: boolean
}

export interface BriefTemplate {
  id: string
  briefType: string
  /** What it is CALLED. Data, not an i18n key — a template the tenant creates has no key. */
  nameEn: string
  nameAr: string | null
  /** One line under the name on a brief card (SJ-v3-01) — what this brief is for. */
  descriptionEn: string | null
  descriptionAr: string | null
  fields: BriefTemplateField[]
  isActive: boolean
  /** The departments whose campaign briefs are written from this template.
   *  `isDefault` is that DEPARTMENT's default, not the template's — the Social brief may be
   *  Content's normal brief and merely available to Creative (I40.19). */
  departments: { id: string; name: string; isDefault: boolean }[]
}

export const briefTemplateKeys = {
  all: ['brief-templates'] as const,
}

function toField(raw: unknown): BriefTemplateField | null {
  const f = raw as Partial<BriefTemplateField> | null
  if (!f || typeof f.key !== 'string' || typeof f.en !== 'string') return null
  return {
    key: f.key,
    en: f.en,
    ar: typeof f.ar === 'string' ? f.ar : '',
    guidance: typeof f.guidance === 'string' ? f.guidance : '',
    multiline: f.multiline !== false,
    essential: f.essential === true,
  }
}

export function useBriefTemplates() {
  return useQuery({
    queryKey: briefTemplateKeys.all,
    // Always fresh: the pairings are set by an administrator, often in another tab, and the
    // single-job picker reads them (SJ-v3-01). The app's 30-second default left the picker
    // showing "no department yet" after the assignment was made (Edward, 22 Sep).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<BriefTemplate[]> => {
      const { data, error } = await supabaseUntyped
        .from('brief_templates')
        // `departments` is a to-MANY embed on the reverse FK: every department pointing at this
        // template. That is the assignment, read from the template's end.
        .select(
          'id, brief_type, name_en, name_ar, description_en, description_ar, fields, is_active, ' +
            // Both hops NAME their constraint. The keys here are composite (the tenant fence), and
            // the one working composite embed in this codebase names its own — PostgREST is not
            // asked to infer a relationship it may not offer.
            'department_brief_templates!fk_dbt_template(department_id, is_default, ' +
            'departments!fk_dbt_department(id, name))',
        )
        .order('name_en')
      if (error) throw error
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        briefType: r.brief_type as string,
        // Falls back to the key so a row added before the column existed never renders blank.
        nameEn: (r.name_en as string | null) ?? (r.brief_type as string),
        nameAr: (r.name_ar as string | null) ?? null,
        descriptionEn: (r.description_en as string | null) ?? null,
        descriptionAr: (r.description_ar as string | null) ?? null,
        fields: (Array.isArray(r.fields) ? r.fields : []).map(toField).filter(Boolean) as BriefTemplateField[],
        isActive: r.is_active as boolean,
        departments: ((r.department_brief_templates ?? []) as unknown as Record<string, unknown>[])
          .map((j) => {
            const d = j.departments as { id: string; name: string } | { id: string; name: string }[] | null
            const dept = Array.isArray(d) ? (d[0] ?? null) : d
            return dept ? { ...dept, isDefault: j.is_default === true } : null
          })
          .filter(Boolean)
          .map((d) => d as { id: string; name: string; isDefault: boolean })
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
    },
  })
}

/**
 * Save a template: its fields, and since I54.3 its NAME and DESCRIPTION in both languages.
 *
 * Until 23 Sep this wrote `fields` alone. A template made on this screen took its English name at
 * creation and could never be changed, had no Arabic name at all, and no description ever — and
 * the description is what the twelve cards on the first screen of the single-job flow read out to
 * the person choosing between them.
 *
 * `brief_type`, the key a written brief stores itself under, is NOT touched. It is derived from the
 * name once, at creation, and renaming must never orphan the briefs already written (see
 * `useCreateBriefTemplate`). That is what makes renaming safe to offer at all — including for the
 * twelve templates that ship with the system (Edward, 23 Sep: *"all templates can be renamed"*).
 *
 * An empty Arabic field is stored as NULL rather than '': the read falls back to the English name,
 * and a blank string would defeat that and render an empty card.
 */
export function useSaveBriefTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      fields,
      nameEn,
      nameAr,
      descriptionEn,
      descriptionAr,
    }: {
      id: string
      fields: BriefTemplateField[]
      nameEn?: string
      nameAr?: string | null
      descriptionEn?: string | null
      descriptionAr?: string | null
    }) => {
      const patch: Record<string, unknown> = { fields }
      // Only what the caller passed. `undefined` means "leave it alone"; null means "clear it".
      if (nameEn !== undefined) {
        const trimmed = nameEn.trim()
        if (!trimmed) throw new Error('A template needs a name.')
        patch.name_en = trimmed
      }
      if (nameAr !== undefined) patch.name_ar = nameAr?.trim() || null
      if (descriptionEn !== undefined) patch.description_en = descriptionEn?.trim() || null
      if (descriptionAr !== undefined) patch.description_ar = descriptionAr?.trim() || null
      const { error } = await supabaseUntyped
        .from('brief_templates')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: briefTemplateKeys.all }),
  })
}

/**
 * Create a template.
 *
 * There was no way to make one at all until 30 Aug — the screen could edit the eleven seeded rows'
 * fields and nothing else — so a tenant whose work did not fit the agency's deck had no recourse.
 *
 * `brief_type` is the stable key the rest of the system stores; the NAME is what people read. The
 * key is derived from the name once, at creation, and never changes afterwards: renaming a template
 * must not orphan the briefs already written from it.
 */
export function useCreateBriefTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: { tenantId: string; nameEn: string; nameAr: string | null; fields?: BriefTemplateField[] }) => {
      const key = slugForBriefType(t.nameEn)
      if (!key) throw new Error('A template needs a name.')
      const { error } = await supabaseUntyped.from('brief_templates').insert({
        tenant_id: t.tenantId,
        brief_type: key,
        name_en: t.nameEn.trim(),
        name_ar: t.nameAr?.trim() || null,
        // Empty unless started from another template (I49.81). ADR-0048 d.2: a template with no
        // fields is UNSELECTABLE, because one that silently generates an empty brief looks
        // broken — so the editor's Add field row is where an empty one becomes usable.
        fields: t.fields ?? [],
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: briefTemplateKeys.all }),
  })
}

/** A stable, readable key from a name. Lowercase, underscores, no punctuation. */
export function slugForBriefType(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

/**
 * Add or remove one department↔template pairing.
 *
 * A row means "this department MAY write from this template". Several rows per department is the
 * point: Creative uses the Creative Brief for a campaign and the Execution Brief for a single item,
 * and adding the second must not take away the first — which is exactly what the column this
 * replaces did.
 */
export function useSetDepartmentTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: {
      tenantId: string
      departmentId: string
      briefTemplateId: string
      allowed: boolean
    }) => {
      if (a.allowed) {
        const { error } = await supabaseUntyped.from('department_brief_templates').insert({
          tenant_id: a.tenantId,
          department_id: a.departmentId,
          brief_template_id: a.briefTemplateId,
        })
        if (error) throw error
      } else {
        const { error } = await supabaseUntyped
          .from('department_brief_templates')
          .delete()
          .eq('department_id', a.departmentId)
          .eq('brief_template_id', a.briefTemplateId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: briefTemplateKeys.all })
      void qc.invalidateQueries({ queryKey: ['department-templates'] })
    },
  })
}

/**
 * Which of a department's briefs it writes by default (I40.19).
 *
 * Edward, 6 Sep: *"before all these changes were made, selecting a campaign was automatic… this was
 * working in early versions."* It was, and this is the setting that was lost: a department had ONE
 * template until `20260830230000` made availability many-to-many so Creative could hold a second
 * brief. The default restores the automatic answer and keeps the second brief.
 *
 * An RPC and not two updates: a partial unique index allows one default per department, so clearing
 * the old and setting the new must be one transaction or the second write is rejected and the
 * department is left with none. Pass a null template to go back to being asked.
 */
export function useSetDefaultDepartmentBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { departmentId: string; briefTemplateId: string | null }) => {
      const { error } = await supabaseUntyped.rpc('set_department_default_brief', {
        p_department: a.departmentId,
        p_template: a.briefTemplateId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: briefTemplateKeys.all })
      void qc.invalidateQueries({ queryKey: ['department-templates'] })
    },
  })
}
