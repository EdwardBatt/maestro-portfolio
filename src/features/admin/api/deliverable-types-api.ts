import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PickableDeliverable } from '../../../lib/deliverables/rank-deliverables'
import { supabaseUntyped } from '../../../lib/supabase'
import { languageWords } from '../../../lib/languages/language-words'

/**
 * The deliverable taxonomy as tenant data (ADR-0051, I18.4).
 *
 * Three lists, one shape: categories, types, and the six attribute lists that share a table.
 * All are **seeded then owned** — the 16/240/48 rows a tenant starts with are a starting point,
 * not a contract, and the same authority that edits roles and offices edits these
 * (`organization:manage`, enforced by RLS; the surface only decides whether to offer the attempt).
 *
 * Deactivate, never delete. A type is a record of what was agreed on work already done, and the
 * FK from `deliverables` would refuse the delete anyway — so `is_active = false` removes it from
 * every picker while every deliverable already carrying it keeps displaying it (ADR-0051 d.13).
 */

export interface DeliverableCategory {
  id: string
  code: string
  nameEn: string
  nameAr: string | null
  sortOrder: number
  isActive: boolean
}

export interface DeliverableType {
  id: string
  code: string
  categoryCode: string
  nameEn: string
  nameAr: string | null
  isActive: boolean
  leadTimeHours: number | null
  defaultLoadPct: number | null
  revisionLimit: number | null
  /**
   * ADR-0052: the template whose steps become this type's task list.
   *
   * Read by `app.materialise_deliverable_workflow` and, until I19.11, written by nothing — so
   * every one of the 240 seeded types held null and setting a type on a deliverable created no
   * tasks. Null is still legal and always will be: a type with no template simply implies no
   * standard task list, and the deliverable is broken down by hand.
   */
  defaultWorkflowTemplateId: string | null
}

/** One value in one of the six attribute lists. `attribute` is the list it belongs to. */
export interface AttributeValue {
  id: string
  attribute: string
  code: string
  labelEn: string
  labelAr: string | null
  sortOrder: number
  isActive: boolean
}

export const taxonomyKeys = {
  categories: ['deliverable-categories'] as const,
  types: ['deliverable-types'] as const,
  attributes: ['deliverable-attribute-values'] as const,
}

export function useDeliverableCategories() {
  return useQuery({
    queryKey: taxonomyKeys.categories,
    queryFn: async (): Promise<DeliverableCategory[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_categories')
        .select('id, code, name_en, name_ar, sort_order, is_active')
        .order('sort_order')
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        code: r.code as string,
        nameEn: r.name_en as string,
        nameAr: (r.name_ar as string | null) ?? null,
        sortOrder: r.sort_order as number,
        isActive: r.is_active as boolean,
      }))
    },
  })
}

/**
 * Every type, active and not. The Admin screen shows both — a deactivated type still exists and
 * still has to be findable to be reactivated. Pickers filter to active themselves.
 */
export function useDeliverableTypes() {
  return useQuery({
    queryKey: taxonomyKeys.types,
    queryFn: async (): Promise<DeliverableType[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_types')
        .select('id, code, category_code, name_en, name_ar, is_active, lead_time_hours, default_load_pct, revision_limit, default_workflow_template_id')
        .order('code')
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        code: r.code as string,
        categoryCode: r.category_code as string,
        nameEn: r.name_en as string,
        nameAr: (r.name_ar as string | null) ?? null,
        isActive: r.is_active as boolean,
        leadTimeHours: (r.lead_time_hours as number | null) ?? null,
        defaultLoadPct: (r.default_load_pct as number | null) ?? null,
        revisionLimit: (r.revision_limit as number | null) ?? null,
        defaultWorkflowTemplateId: (r.default_workflow_template_id as string | null) ?? null,
      }))
    },
  })
}

export function useAttributeValues() {
  return useQuery({
    queryKey: taxonomyKeys.attributes,
    queryFn: async (): Promise<AttributeValue[]> => {
      const { data, error } = await supabaseUntyped
        .from('deliverable_attribute_values')
        .select('id, attribute, code, label_en, label_ar, sort_order, is_active')
        .order('attribute')
        .order('sort_order')
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        attribute: r.attribute as string,
        code: r.code as string,
        labelEn: r.label_en as string,
        labelAr: (r.label_ar as string | null) ?? null,
        sortOrder: r.sort_order as number,
        isActive: r.is_active as boolean,
      }))
    },
  })
}

/** Rename a type, retune its settings, or deactivate it. RLS decides; this only asks. */
export function useSaveDeliverableType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: Pick<DeliverableType, 'id'> & Partial<DeliverableType>) => {
      const typePatch: Record<string, unknown> = {}
      if (t.nameEn !== undefined) typePatch.name_en = t.nameEn
      if (t.nameAr !== undefined) typePatch.name_ar = t.nameAr || null
      if (t.isActive !== undefined) typePatch.is_active = t.isActive
      if (t.leadTimeHours !== undefined) typePatch.lead_time_hours = t.leadTimeHours
      if (t.revisionLimit !== undefined) typePatch.revision_limit = t.revisionLimit
      const { error } = await supabaseUntyped.from('deliverable_types').update(typePatch).eq('id', t.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: taxonomyKeys.types }),
  })
}

/**
 * Add a type the seed does not have.
 *
 * `categoryCode` is required and must name an existing category — there is no "Uncategorised"
 * and no null (ADR-0051 d.5), because a type in no category cannot be reached by the wizard's own
 * Category → Deliverable navigation. The composite FK refuses a category from another tenant.
 */
export function useCreateDeliverableType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: { tenantId: string; code: string; categoryCode: string; nameEn: string; nameAr: string }) => {
      const { error } = await supabaseUntyped.from('deliverable_types').insert({
        tenant_id: t.tenantId,
        code: t.code.trim(),
        category_code: t.categoryCode,
        name_en: t.nameEn.trim(),
        name_ar: t.nameAr.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: taxonomyKeys.types }),
  })
}

/** Add a value to one of the six lists — the thing that would otherwise need a migration. */
export function useCreateAttributeValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { tenantId: string; attribute: string; code: string; labelEn: string; labelAr: string }) => {
      const { error } = await supabaseUntyped.from('deliverable_attribute_values').insert({
        tenant_id: v.tenantId,
        attribute: v.attribute,
        code: v.code.trim().toUpperCase(),
        label_en: v.labelEn.trim(),
        label_ar: v.labelAr.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: taxonomyKeys.attributes }),
  })
}

export function useSaveAttributeValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; labelEn?: string; labelAr?: string | null; isActive?: boolean }) => {
      const valuePatch: Record<string, unknown> = {}
      if (v.labelEn !== undefined) valuePatch.label_en = v.labelEn
      if (v.labelAr !== undefined) valuePatch.label_ar = v.labelAr || null
      if (v.isActive !== undefined) valuePatch.is_active = v.isActive
      const { error } = await supabaseUntyped.from('deliverable_attribute_values').update(valuePatch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: taxonomyKeys.attributes }),
  })
}

/**
 * The catalogue as the picker wants it (ADR-0097 d.7): every ACTIVE type with its category's name
 * and order, the "260 deliverables" the team chooses from. One hook so the wizard, the campaign
 * page and the intake flow all read the same list.
 */
export function useDeliverableCatalogue(): { items: PickableDeliverable[]; isLoading: boolean; isError: boolean } {
  const types = useDeliverableTypes()
  const categories = useDeliverableCategories()
  // I53.23 (21 Sep): named in the interface language — the catalogue carries an Arabic name on
  // every row and the picker never read it — with the other language searchable (`nameAlt`).
  const { i18n } = useTranslation()
  const ar = i18n.language === 'ar'
  const items = useMemo(() => {
    const cats = new Map((categories.data ?? []).map((c) => [c.code, c]))
    return (types.data ?? [])
      .filter((x) => x.isActive)
      .map((x) => {
        const cat = cats.get(x.categoryCode)
        return {
          id: x.id,
          code: x.code,
          name: (ar && x.nameAr) || x.nameEn,
          nameAlt: ar ? x.nameEn : x.nameAr,
          category: (ar && cat?.nameAr) || cat?.nameEn || x.categoryCode,
          categoryOrder: cat?.sortOrder ?? 0,
        }
      })
  }, [types.data, categories.data, ar])
  return { items, isLoading: types.isLoading || categories.isLoading, isError: types.isError || categories.isError }
}


/** ADR-0117 d.3: add a language the tenant's list does not have — anyone who manages campaigns may.
 *  Resolves to its code (an existing one of that name is returned, not duplicated). */
export function useAddLanguage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (label: string): Promise<string> => {
      const { data, error } = await supabaseUntyped.rpc('add_language', { p_label: label })
      if (error) throw error
      return data as string
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: taxonomyKeys.attributes }),
  })
}

/**
 * ADR-0117 addendum (Q18, 4 Oct): the tenant's languages, to choose from (active only) and to name a deliverable's
 * languages with ("English, Arabic, Kurdish", in the reader's language — inactive ones included, so a language since
 * retired still reads as its name).
 */
export function useLanguageWords() {
  const values = useAttributeValues()
  const { i18n } = useTranslation()
  const locale: 'en' | 'ar' = i18n.language === 'ar' ? 'ar' : 'en'
  return useMemo(() => {
    const all = (values.data ?? []).filter((v) => v.attribute === 'language')
    return {
      options: all.filter((v) => v.isActive).map((v) => ({ code: v.code, label: (locale === 'ar' && v.labelAr) || v.labelEn })),
      words: (codes: readonly string[] | null | undefined) => languageWords(codes, all, locale),
    }
  }, [values.data, locale])
}
