import type { ReviewComment } from '../api/review-api'

/**
 * ADR-0112 d.2 (I59.29): a comment list, split into pins (top level) and the replies under each
 * (`review_feedback.parent_id`). Pure, so the review panel, the manual thread and the task page
 * all thread the same way.
 */
export function threadComments(list: readonly ReviewComment[]): {
  pins: ReviewComment[]
  repliesOf: (pinId: string) => ReviewComment[]
} {
  const pins = list.filter((c) => !c.parentId)
  const ids = new Set(pins.map((c) => c.id))
  const byPin = new Map<string, ReviewComment[]>()
  for (const c of list) {
    // A reply whose pin is not in this list (another file's) is left out rather than shown loose.
    if (c.parentId && ids.has(c.parentId)) (byPin.get(c.parentId) ?? byPin.set(c.parentId, []).get(c.parentId)!).push(c)
  }
  return { pins, repliesOf: (id) => byPin.get(id) ?? [] }
}
