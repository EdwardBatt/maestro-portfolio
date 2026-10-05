/**
 * Which catalogue deliverables match what you typed, and in what order (ADR-0097 d.7, I53.3).
 *
 * The catalogue is 260-odd rows in 16 categories — the "260 deliverables" as the team names them
 * (the code calls the table `deliverable_types`). Nobody scrolls that; they type "reel" or "SOC-0"
 * or "video". The match is ours for the same reason `rankPeople` is: every browser's `<datalist>`
 * answers differently and cannot be grouped.
 *
 * Ranking, each tier keeping the catalogue's own order: the name or code STARTS with the query,
 * then the name or code CONTAINS it, then the category name contains it. Twelve names are shared
 * across categories (ADR-0054's table), so the category is always shown beside the name and is
 * searchable — "Reel video" finds the VIDEO one.
 */
export interface PickableDeliverable {
  id: string
  code: string
  /** The name in the interface language (I53.23: Arabic in the Arabic UI). */
  name: string
  /** The name in the OTHER language — searchable, never shown, so an English name still finds the
   *  entry in Arabic and vice versa (the catalogue's Arabic names are the team's own). */
  nameAlt?: string | null
  /** The category's name, shown beside the entry and searchable. */
  category: string
  /** Sorts the groups; the catalogue's own category order. */
  categoryOrder?: number
}

export function rankDeliverables(items: readonly PickableDeliverable[], query: string): PickableDeliverable[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const starts: PickableDeliverable[] = []
  const contains: PickableDeliverable[] = []
  const byCategory: PickableDeliverable[] = []
  for (const it of items) {
    const name = it.name.toLowerCase()
    const alt = (it.nameAlt ?? '').toLowerCase()
    const code = it.code.toLowerCase()
    if (name.startsWith(q) || alt.startsWith(q) || code.startsWith(q)) starts.push(it)
    else if (name.includes(q) || alt.includes(q) || code.includes(q)) contains.push(it)
    else if (it.category.toLowerCase().includes(q)) byCategory.push(it)
  }
  return [...starts, ...contains, ...byCategory]
}

/** The matches in category groups, in category order, each group in the rank order given. */
export function groupByCategory(ranked: readonly PickableDeliverable[]): { category: string; items: PickableDeliverable[] }[] {
  const groups = new Map<string, { category: string; order: number; items: PickableDeliverable[] }>()
  for (const it of ranked) {
    const g = groups.get(it.category)
    if (g) g.items.push(it)
    else groups.set(it.category, { category: it.category, order: it.categoryOrder ?? 0, items: [it] })
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category))
    .map(({ category, items }) => ({ category, items }))
}
