import type { ReopenResult } from '../api/reopen-api'

/**
 * What a re-open says once done (ADR-0142 d.2): back with its maker and placed on her week, or — when the lead gave it
 * to someone else — given or asked of their lead; the campaign opening with it; a round that could not be placed.
 */
export function reopenDoneText(t: (key: string, o?: Record<string, unknown>) => string, r: ReopenResult): string {
  const parts = [
    t(r.campaignReopened ? 'amendments.reopen.doneWithCampaign' : 'amendments.reopen.done', { count: r.reopened }),
    r.reassigned === 'assigned' ? t('amendments.reopen.reassigned') : r.reassigned === 'requested' ? t('amendments.reopen.reassignAsked') : null,
    r.scheduleWarning ? t('amendments.reopen.notPlaced') : null,
  ]
  return parts.filter(Boolean).join(' ')
}
