import { useMemo } from 'react'
import { useCampaignPulse } from '../../campaigns/api/campaign-pulse-api'
import { useCampaignList, type CampaignListRow } from '../../campaigns/api/campaign-api'
import { useNeedsYouItems } from '../../deliverables/api/use-needs-you-items'
import { pieceThreatensDeadline, type PulsePiece } from '../../../lib/campaigns/pulse'

/**
 * What the clients list (CV-01) and a client's page (CV-02) say about each client's work, read from what
 * Maestro already records (ADR-0123 d.8) — the campaigns list's own reads, so the three screens agree:
 *
 *   - Live: campaigns and single jobs raised and not closed (a draft wizard is not a campaign).
 *   - On time: of the live campaigns' unfinished pieces, those not late or at risk (ADR-0075, the same
 *     test as the campaigns list's badge), on the client's own working week (ADR-0123 d.3).
 *   - Needs you: the viewer's Needs you items about a piece of this client's.
 *   - Last activity: the latest change to any of the client's campaigns.
 */

export interface ClientCampaign {
  row: CampaignListRow
  pieces: readonly PulsePiece[]
  hasPhases: boolean
  phases: readonly { number: number; name: string; startsOn: string; endsOn: string }[]
}

export interface ClientWork {
  live: number
  onTime: number
  unfinished: number
  needsYou: number
  lastActivity: string | null
  campaigns: ClientCampaign[]
}

const EMPTY: ClientWork = { live: 0, onTime: 0, unfinished: 0, needsYou: 0, lastActivity: null, campaigns: [] }
const LIVE = new Set(['pending_approval', 'approved'])
const FINISHED = new Set(['approved', 'delivered', 'archived'])

export function useClientWork(myId: string | null) {
  const pulse = useCampaignPulse()
  const list = useCampaignList()
  const ny = useNeedsYouItems(myId)

  const byClient = useMemo(() => {
    const out = new Map<string, ClientWork>()
    const rows = new Map((list.data ?? []).map((c) => [c.id, c]))
    const clientOfPiece = new Map<string, string>()
    const now = Date.now()
    for (const src of pulse.data?.values() ?? []) {
      const row = rows.get(src.campaignId)
      if (!row || !src.clientId || row.status === 'draft') continue
      const w = out.get(src.clientId) ?? { ...EMPTY, campaigns: [] }
      out.set(src.clientId, w)
      w.campaigns.push({ row, pieces: src.pieces, hasPhases: src.hasPhases, phases: src.phases })
      if (row.updatedAt && (!w.lastActivity || row.updatedAt > w.lastActivity)) w.lastActivity = row.updatedAt
      for (const p of src.pieces) if (p.id) clientOfPiece.set(p.id, src.clientId)
      if (!LIVE.has(row.status)) continue
      w.live += 1
      for (const p of src.pieces) {
        if (FINISHED.has(p.state)) continue
        w.unfinished += 1
        if (!pieceThreatensDeadline(p, { now })) w.onTime += 1
      }
    }
    for (const it of ny.items) {
      const r = (it.ref ?? {}) as Record<string, unknown>
      const piece = typeof r.deliverableId === 'string' ? r.deliverableId : null
      const client = piece ? clientOfPiece.get(piece) : undefined
      if (client) out.get(client)!.needsYou += 1
    }
    return out
  }, [pulse.data, list.data, ny.items])

  return {
    of: (clientId: string): ClientWork => byClient.get(clientId) ?? EMPTY,
    isLoading: pulse.isLoading || list.isLoading,
    isError: pulse.isError || list.isError,
  }
}
