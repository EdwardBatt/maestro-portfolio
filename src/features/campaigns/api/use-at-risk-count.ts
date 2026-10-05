import { useMemo } from 'react'
import { countThreatened } from '../../../lib/campaigns/pulse'
import { useCampaignPulse } from './campaign-pulse-api'

/**
 * The "At risk" tile on the dashboard and the Team page (I57.13): pieces late or at risk by
 * ADR-0075, counted over the SAME read and the same test as the campaigns list's badge, so the three
 * cannot disagree. `owners` narrows it to pieces owned by those people (the Team page's team or
 * department); omitted, it counts every campaign. Null while the read is in flight or failed.
 */
export function useAtRiskCount(owners?: ReadonlySet<string>): number | null {
  const pulse = useCampaignPulse()
  return useMemo(() => {
    if (!pulse.data) return null
    const pieces = [...pulse.data.values()].flatMap((c) => c.pieces)
    return countThreatened(pieces, { now: Date.now() }, owners)
  }, [pulse.data, owners])
}
