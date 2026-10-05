import type { DeliverableRow } from '../../deliverables/api/deliverables-api'

/**
 * How a campaign page divides itself (ADR-0050 d.4; the label is the department, ADR-0053 d.1).
 *
 * The sections are per DEPARTMENT, and a department earns one by having EITHER deliverables OR a
 * brief — the union of the two, not the deliverables alone.
 *
 * ADR-0050 moved the brief off the stream onto `campaign_briefs (campaign_id, department_id, …)`.
 * Sourcing the sections from the briefs alone would render an empty page for every campaign that
 * exists today, because nothing writes that table yet (`generate-brief` is built but unwired,
 * I16.4). Sourcing them from the deliverables alone — which is what this did first — hides a
 * department whose brief exists but whose deliverables have not been created, on the one screen
 * whose job is to have every brief READ before the campaign is approved (ADR-0048 d.9). Both
 * sources are partial in a different direction, so the page takes both.
 */

/** The key a deliverable with no department is grouped under. Not an id — no department has one. */
export const UNASSIGNED = 'unassigned'

export interface CampaignSection {
  /** Stable per section: the department's id, or `unassigned`. React keys and test ids use it. */
  key: string
  /** Null for the unassigned group — which is what makes that group findable rather than dropped. */
  departmentId: string | null
  /** The department's own name (ADR-0053 d.1 — the tenant's word, never a seeded one). */
  name: string | null
  deliverables: DeliverableRow[]
}

/**
 * Just enough of a department brief to raise a section for it — deliberately structural, so this
 * module does not depend on the campaign API's shape (`DepartmentBrief` satisfies it).
 */
export interface BriefedDepartment {
  departmentId: string | null
  departmentName: string | null
}

/**
 * Group a campaign into the sections the page renders: one per department that has deliverables,
 * a brief, or both.
 *
 * **A department with a brief and no deliverables still appears**, with an empty deliverables list
 * — because the approval surface exists to have the briefs read (ADR-0048 d.9), and a brief with
 * no section is a brief nobody was shown.
 *
 * **A deliverable with no department still appears too.** `deliverables.department_id` is stamped
 * from the owner (ADR-0050), and an unowned deliverable has none — so grouping on the department
 * alone would drop exactly the work nobody has picked up, which is the work most worth seeing on
 * an approval screen. It gets its own section, last, because it is a gap to close rather than a
 * department. Within a section the incoming order is kept: the query returns oldest first, which is
 * the order the campaign generated them in.
 */
export function departmentSections(
  rows: DeliverableRow[],
  briefs: readonly BriefedDepartment[] = [],
): CampaignSection[] {
  const byKey = new Map<string, CampaignSection>()

  const sectionFor = (departmentId: string | null): CampaignSection => {
    const key = departmentId ?? UNASSIGNED
    let section = byKey.get(key)
    if (!section) {
      section = { key, departmentId, name: null, deliverables: [] }
      byKey.set(key, section)
    }
    return section
  }

  for (const row of rows) {
    const section = sectionFor(row.departmentId)
    // The name comes off whichever row carries one — a null there is a missing join, not a rename.
    section.name ??= row.discipline
    section.deliverables.push(row)
  }

  // Then the briefs, which can both raise a section of their own and name one the join left blank.
  for (const brief of briefs) {
    const section = sectionFor(brief.departmentId)
    section.name ??= brief.departmentName?.trim() || null
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.departmentId === null) return 1
    if (b.departmentId === null) return -1
    // Name first, then the id — so two departments with the same (or no) name still order the same
    // way on every render rather than falling back to whichever source happened to arrive first.
    return (a.name ?? '').localeCompare(b.name ?? '') || a.key.localeCompare(b.key)
  })
}
