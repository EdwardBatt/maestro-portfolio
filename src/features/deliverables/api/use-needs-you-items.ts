import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { pendingApprovalLink, usePendingApprovals } from './pending-approvals-api'
import { useAwaitingMyReview, useMyAssignedWork } from './deliverables-api'
import { useUnassignedPiecesIOwn } from './needs-you-api'
import { useNeedsYouSources } from './needs-you-sources-api'
import { openWork } from '../lib/my-work'
import {
  fromChangesBack,
  fromNewOnYou,
  fromPendingApprovals,
  fromReviews,
  fromUnassigned,
  isChangesRequested,
  type NeedsYouItem,
} from '../lib/needs-you'
import {
  fromBlocks,
  fromChangeAsks,
  fromChangeRequests,
  fromClientWaiting,
  fromEscalations,
  fromExtensionSteps,
  fromMessages,
  fromOverload,
  fromScopeUnacknowledged,
  withoutDuplicateExtensions,
} from '../lib/needs-you-requests'

/**
 * Everything asking `myId` to act, as one list of Needs you items (ADR-0105 d.2). The one assembly of
 * the sources, shared by the Needs you panel on My Work and the Dashboard's "Waiting on you" and
 * "What to touch today" (ADR-0122 d.4), so the two can never count differently. The queries are
 * returned too: the panel reads them for its load errors and the review modal.
 */
export function useNeedsYouItems(myId: string | null) {
  const { t } = useTranslation()
  const pending = usePendingApprovals()
  const awaiting = useAwaitingMyReview(myId)
  const unassigned = useUnassignedPiecesIOwn(myId)
  const work = useMyAssignedWork(myId)
  const mine = useMemo(() => openWork(work.data ?? []), [work.data])
  const reviewIds = useMemo(() => (awaiting.data ?? []).map((r) => r.subTaskId), [awaiting.data])
  const sentBackIds = useMemo(() => mine.filter(isChangesRequested).map((r) => r.subTaskId), [mine])
  const src = useNeedsYouSources(myId, reviewIds, sentBackIds)

  const items = useMemo(() => {
    const say = (key: string, vars?: Record<string, unknown>) => t(key, vars ?? {})
    const rules = src.rules.data ?? null
    const steps = src.extensions.data ?? []
    const approvals = fromPendingApprovals(
      pending.data ?? [],
      pendingApprovalLink,
      (department, campaign) => t('waitingForYou.writeBriefTitle', { department, campaign }),
      rules,
      {
        approve: (deliverable) => t('waitingForYou.approveListTitle', { deliverable }),
        define: (deliverable) => t('waitingForYou.defineTasksTitle', { deliverable }),
        allCancelled: (deliverable) => t('waitingForYou.allCancelledTitle', { deliverable }),
        handover: (name, left) => (left == null ? t('waitingForYou.handoverTitleBare', { name }) : t('waitingForYou.handoverTitle', { name, n: left })),
      },
    )
    return [
      ...withoutDuplicateExtensions(approvals, steps),
      ...fromReviews(awaiting.data ?? [], src.sentAt.data, rules),
      ...fromUnassigned(unassigned.data ?? [], rules),
      ...fromChangesBack(mine, src.cameBack.data),
      ...fromNewOnYou(mine),
      ...fromBlocks(src.blocks.data ?? [], rules, say),
      ...fromExtensionSteps(steps, rules, say),
      ...fromChangeRequests(src.changes.data ?? [], rules, say),
      ...fromMessages(src.messages.data ?? [], say),
      ...fromOverload(src.overload.data ?? [], say),
      ...fromEscalations(src.escalations.data ?? [], say),
      ...fromClientWaiting(src.client.data ?? [], say),
      ...fromScopeUnacknowledged(src.scope.data ?? [], say),
      ...fromChangeAsks(src.changeAsks.data ?? [], rules, say),
    ] as NeedsYouItem[]
  }, [
    pending.data, awaiting.data, unassigned.data, mine, t,
    src.rules.data, src.sentAt.data, src.cameBack.data, src.blocks.data, src.extensions.data, src.changes.data,
    src.messages.data, src.overload.data, src.escalations.data, src.client.data, src.scope.data, src.changeAsks.data,
  ])

  const isLoading = pending.isLoading || awaiting.isLoading || unassigned.isLoading || work.isLoading
  return { items, isLoading, pending, awaiting, unassigned, work, mine, src }
}
