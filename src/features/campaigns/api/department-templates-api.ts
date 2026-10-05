import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import type { BriefTemplateField } from '../../admin/api/brief-templates-api'

/**
 * Which template each department writes its briefs from (ADR-0048 d.5).
 *
 * **Nothing here decides anything.** The department carries the answer, an administrator set it on
 * Admin → Brief templates, and this reads it. That is the whole point of the shape Edward asked
 * for: no picker in the wizard, no picker at review, no mapping inferred from a department's name
 * — because *"this is a multitenant system… not everyone uses the same org structure and names
 * their departments differently."*
 *
 * A department may have SEVERAL — Creative writes a Creative Brief for a campaign and an Execution
 * Brief for a single banner — so this returns the list it may use. With exactly one, nobody is
 * asked. With none, the page says so and links to the fix; that is not an error, since most
 * departments never own a deliverable.
 *
 * **And with several, one of them is normally its DEFAULT** (I40.19). Edward, 6 Sep: *"before all
 * these changes were made, selecting a campaign was automatic."* It was — a department had one
 * template, on a column `20260830230000` dropped when it made availability many-to-many so Creative
 * could hold a second brief. The default restores the automatic answer without restoring the limit.
 * Where a department has no default and several templates, the campaign page still asks.
 */

export interface AvailableTemplate {
  id: string
  briefType: string
  nameEn: string
  /** I40.19: the one this department writes unless somebody says otherwise. At most one is true. */
  isDefault: boolean
  fields: BriefTemplateField[]
}

export interface DepartmentTemplate {
  departmentId: string
  departmentName: string
  /** Every template this department MAY write from. Empty when nobody has assigned one. */
  templates: AvailableTemplate[]
}

export const departmentTemplateKeys = {
  all: ['department-templates'] as const,
}

export function useDepartmentTemplates() {
  return useQuery({
    queryKey: departmentTemplateKeys.all,
    queryFn: async (): Promise<Map<string, DepartmentTemplate>> => {
      const { data, error } = await supabaseUntyped
        .from('departments')
        // A LEFT embed through the join: a department with no template must still come back, or
        // the page cannot tell "none assigned" from "department does not exist".
        // `is_default` is the JOIN row's column — without it here every template read as
        // not-default and the campaign page asked for a choice on every campaign (I49.82).
        .select(
          'id, name, department_brief_templates!fk_dbt_department(is_default, ' +
            'brief_templates!fk_dbt_template(id, brief_type, name_en, fields))',
        )
        .order('name')
      if (error) throw error

      const out = new Map<string, DepartmentTemplate>()
      for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
        const joins = (r.department_brief_templates ?? []) as Record<string, unknown>[]
        const templates: AvailableTemplate[] = joins
          .map((j) => {
            // PostgREST types a to-one embed as an array; the runtime returns the object.
            const raw = j.brief_templates as Record<string, unknown> | Record<string, unknown>[] | null
            const tpl = (Array.isArray(raw) ? raw[0] : raw) ?? null
            // The flag lives on the JOIN row, not the template: the Social brief may be Content's
            // default and merely available to Creative.
            return tpl ? { tpl, isDefault: j.is_default === true } : null
          })
          .filter(Boolean)
          .map((row) => {
            const { tpl, isDefault } = row as { tpl: Record<string, unknown>; isDefault: boolean }
            return {
              id: tpl.id as string,
              briefType: tpl.brief_type as string,
              nameEn: (tpl.name_en as string | null) ?? (tpl.brief_type as string),
              isDefault,
              fields: (Array.isArray(tpl.fields) ? tpl.fields : []) as BriefTemplateField[],
            }
          })
          // The default first, then alphabetical — so a list that IS asked about leads with the
          // answer, and one that is not reads the same as it always did.
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.nameEn.localeCompare(b.nameEn))

        out.set(r.id as string, {
          departmentId: r.id as string,
          departmentName: r.name as string,
          templates,
        })
      }
      return out
    },
  })
}

/**
 * Every active brief template in the tenant — the fallback list.
 *
 * Edward, 6 Sep: *"if there are no briefs assigned at all they must be allowed to pick from the
 * full list."* A department nobody has assigned a template to used to be a dead end on the campaign
 * page: it named the gap and left the reader with nothing to do until an administrator went and
 * fixed the configuration. Non-blocking means the work gets done now and the configuration gets
 * tidied later, so the dropdown falls back to everything rather than to nothing.
 *
 * Inactive templates are excluded: `is_active` false is how a tenant retires one, and offering it
 * here would undo that.
 */
export function useAllBriefTemplates() {
  return useQuery({
    queryKey: [...departmentTemplateKeys.all, 'every'] as const,
    queryFn: async (): Promise<AvailableTemplate[]> => {
      const { data, error } = await supabaseUntyped
        .from('brief_templates')
        .select('id, brief_type, name_en, fields')
        .eq('is_active', true)
        .order('name_en')
      if (error) throw error
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((t) => ({
        id: t.id as string,
        briefType: t.brief_type as string,
        nameEn: (t.name_en as string | null) ?? (t.brief_type as string),
        // Nothing in the fallback list is a default: a default belongs to a department, and this
        // list is what is shown precisely because the department has none.
        isDefault: false,
        fields: (Array.isArray(t.fields) ? t.fields : []) as BriefTemplateField[],
      }))
    },
  })
}
