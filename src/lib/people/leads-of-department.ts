/**
 * Whom an owner list offers (I66.9, Edward 29 Sep): the leads of the deliverable's OWN department — on a campaign,
 * its workstream's department. Edward chose this over "every lead, with a switch for the others": a piece should not
 * change department because someone picked the wrong name from a company-wide list (ADR-0102 moves a piece with its
 * owner). Moving a piece to another department is a separate step — its workstream.
 *
 * No department yet (an ungrouped piece, a new row with no workstream) offers every lead; a department with no lead
 * at all falls back to every lead too, rather than an empty list — the UI never blocks, and the database still
 * decides (`app.tg_deliverable_owner_is_a_lead`).
 */
export function leadsOfDepartment<T extends { departmentId: string | null }>(
  leads: readonly T[],
  departmentId: string | null | undefined,
): T[] {
  if (!departmentId) return [...leads]
  const inDepartment = leads.filter((l) => l.departmentId === departmentId)
  return inDepartment.length > 0 ? inDepartment : [...leads]
}
