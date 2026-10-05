/**
 * The task list a deliverable WILL produce, before it exists (Edward, 22 Sep: *"how can the task
 * list be approved if it cannot be reviewed?"* — options a + b).
 *
 * Tasks are materialised by the database when a typed deliverable is written
 * (`app.materialise_deliverable_workflow`, ADR-0052) — at Approve on the campaign wizard's last
 * step (ADR-0067). So while the wizard is open there is nothing to show, and the account manager
 * approved without ever seeing the work each proposed deliverable would produce. This composes the
 * same list the materialiser will, from the same rows (the type's template's active steps), with
 * the same naming rule (ADR-0071 addendum, 4 Oct) — `<step> — <campaign>` for a step done once,
 * `<step> — <campaign> · <type> <n>` for a step that repeats per unit (no number at quantity 1) — so
 * what is previewed is what appears (`app.compose_task_title`).
 *
 * A PREVIEW ONLY: read from `workflow_steps` in the browser, never written. The real list is
 * reviewed and edited on the department's tab after approval, where it has always been.
 */

export interface PreviewStep {
  templateId: string
  sortOrder: number
  titleEn: string
  titleAr?: string | null
  /** ADR-0071 d.8: the creation step — one task per unit of quantity. */
  repeatsPerUnit?: boolean
  isActive: boolean
}

export interface PreviewInput {
  /** The type's `default_workflow_template_id`; null → no list (a type without a template). */
  templateId: string | null
  /** The campaign's (or single job's) name — every title carries it. */
  campaign: string
  /** The deliverable type's name — a per-unit task carries it. */
  typeName: string | null
  quantity: number
}

export function previewTasks(steps: readonly PreviewStep[], input: PreviewInput, locale: 'en' | 'ar' = 'en'): string[] {
  if (!input.templateId) return []
  const qty = Math.max(input.quantity || 1, 1)
  const campaign = input.campaign.trim()
  const typeName = input.typeName?.trim() ?? ''
  const own = steps
    .filter((s) => s.templateId === input.templateId && s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const out: string[] = []
  for (const s of own) {
    const title = (locale === 'ar' && s.titleAr) || s.titleEn
    const units = s.repeatsPerUnit ? qty : 1
    for (let n = 1; n <= units; n++) {
      out.push(composeTaskTitle(title, campaign, typeName, s.repeatsPerUnit ? n : null, qty))
    }
  }
  return out
}

/**
 * `app.compose_task_title`, exactly (ADR-0071 addendum, 4 Oct): "<step> — <campaign>" for a step done once;
 * "<step> — <campaign> · <type> <n>" for a unit — no number at quantity 1, the number alone with no type.
 */
export function composeTaskTitle(step: string, campaign: string, typeName: string | null, unit: number | null, quantity: number): string {
  const ctx = campaign.trim()
  const unitPart = unit == null ? '' : `${(typeName ?? '').trim()}${quantity > 1 ? ` ${unit}` : ''}`.trim()
  const tail = [ctx, unitPart].filter(Boolean).join(' · ')
  return tail ? `${step.trim()} — ${tail}` : step.trim()
}
