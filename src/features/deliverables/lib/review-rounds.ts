/**
 * Group review comments by their round (ADR-0025, I3.3). Round is server-stamped to the
 * deliverable's revision_round + 1, so grouping here surfaces the rework history: newest round
 * first, comments within a round in their original (created-ascending) order.
 */

export interface RoundGroup<T> {
  round: number
  comments: T[]
}

export function groupByRound<T extends { round: number }>(comments: T[]): RoundGroup<T>[] {
  const byRound = new Map<number, T[]>()
  for (const c of comments) {
    const existing = byRound.get(c.round)
    if (existing) existing.push(c)
    else byRound.set(c.round, [c])
  }
  return [...byRound.entries()]
    .map(([round, items]) => ({ round, comments: items }))
    .sort((a, b) => b.round - a.round)
}
