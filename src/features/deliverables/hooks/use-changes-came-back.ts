import type { AssignedWorkItem } from '../api/deliverables-api'
import { useDeliverableVersions, useVersionComments } from '../api/review-api'
import { threadComments } from '../lib/pin-thread'
import { previousVersion } from '../lib/task-page'

/**
 * The previous version, its pins and this round's version — read once, shared by the M4 view and
 * the page's foot ("Reply to a pin"). React Query caches the reads, so two callers cost one fetch.
 */
export function useChangesCameBack(item: AssignedWorkItem, thisRound: number) {
  const versions = useDeliverableVersions(item.deliverableId, item.subTaskId)
  const prev = previousVersion(versions.data ?? [], thisRound)
  const comments = useVersionComments(prev?.id ?? null)
  // Pins only: a reply is the maker's answer, not something to fix (ADR-0112 d.2).
  const { pins, repliesOf } = threadComments(comments.data ?? [])
  const current = (versions.data ?? []).find((v) => v.round === thisRound) ?? null
  return { prev, pins, repliesOf, current }
}
