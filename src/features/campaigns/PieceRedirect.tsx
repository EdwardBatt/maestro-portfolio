import { useEffect } from 'react'
import { pieceHref } from '../../lib/navigation/piece-link'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { usePieceCampaign } from '../../lib/navigation/piece-campaign'

/**
 * `/campaigns/piece/:deliverableId` — the campaign a deliverable belongs to (I59.45).
 *
 * A notification about a deliverable names the deliverable, and its door is the campaign page
 * (`src/lib/notifications/door.ts`) — where its task list is approved and where anyone with the
 * campaign in view can read it. The email knows the campaign and links straight there; the in-app
 * bell does not, so it links here and this looks it up. Work with no campaign (ad-hoc) has no
 * campaign page, so it lands on My Work — never on a blank screen.
 */
export function PieceRedirect() {
  const { deliverableId } = useParams()
  const navigate = useNavigate()
  // ADR-0132 d.6: arrive with the piece's panel open, and the task marked when one was named.
  const [params] = useSearchParams()
  const task = params.get('task')
  const campaign = usePieceCampaign(deliverableId)

  useEffect(() => {
    if (campaign.isSuccess) navigate(campaign.data ? pieceHref(campaign.data, deliverableId!, task) : '/my-work', { replace: true })
    if (campaign.isError) navigate('/campaigns', { replace: true })
  }, [campaign.isSuccess, campaign.isError, campaign.data, navigate, deliverableId, task])

  if (!deliverableId) return <Navigate to="/campaigns" replace />
  return <p className="muted" data-testid="piece-redirect">…</p>
}
