import { useMemo } from 'react'
import { StatusRollupStrip } from '../../components/StatusRollupStrip'
import { computeRollup, taskCoverage, deliverableProgress } from '../../lib/campaigns/status'
import { useCampaignDeliverables } from '../deliverables/api/deliverables-api'
import { useCampaignDetail } from '../campaigns/api/campaign-detail-api'

/**
 * Delivery status at the head of a campaign room (Edward, 31 Aug).
 *
 * The room is where a campaign gets talked about, so the two questions a person arrives with —
 * how much is done, and is anybody actually on it — belong at the top of it, not one screen away.
 * Same two gauges as `/campaigns/:id`, and deliberately the SAME code and the SAME query.
 *
 * **The hooks are imported across features on purpose.** `chat` reaching into `deliverables` and
 * `campaigns` adds two of the edges STATE.md counts, and the alternative — a chat-local copy of the
 * deliverables read — is worse: it would be a second source for a number the campaign page already
 * shows, and mismatched counts between two surfaces is precisely the bug Edward reported the same
 * afternoon ("the numbers do not match"). One query, one arithmetic, one answer. The presentation
 * moved to `src/components/` so at least the COMPONENT is shared rather than borrowed.
 */
export function CampaignRoomHeader({ campaignId }: { campaignId: string }) {
  const campaign = useCampaignDetail(campaignId)
  const deliverables = useCampaignDeliverables(campaignId)

  const rows = useMemo(() => deliverables.data ?? [], [deliverables.data])
  const rollup = useMemo(() => computeRollup(rows, Date.now()), [rows])
  const coverage = useMemo(() => taskCoverage(rows), [rows])
  const progress = useMemo(() => deliverableProgress(rows), [rows])

  // Silent while loading, and silent on failure: this is context above a conversation, and a
  // broken read here must never take the thread down with it or shout over it. The campaign page
  // is where a failed read is reported, because that is the page whose job it is.
  if (deliverables.isLoading || deliverables.isError) return null

  return (
    <div className="chat-room-status" data-testid="chat-campaign-status">
      <StatusRollupStrip
        rollup={rollup}
        coverage={coverage}
        deliverables={progress}
        approved={campaign.data?.status === 'approved'}
        testId="chat-campaign-rollup"
      />
    </div>
  )
}
