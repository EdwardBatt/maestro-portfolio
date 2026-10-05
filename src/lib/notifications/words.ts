import { formatCalendarDay } from '../time/iraq'

/**
 * The words for one notification: its type's sentence, except where the emitter recorded a fact that
 * changes what is owed — a new owner of an approved list owes nothing (I57.44); a piece with no tasks
 * has no list to approve, its owner defines the tasks (I66.3).
 */
export function notificationTextKey(n: { type: string; detail?: Record<string, unknown> | null }): { key: string; vars?: Record<string, unknown> } {
  const d = n.detail ?? {}
  if (n.type === 'deliverable_reassigned' && d.tasks_approved === true) return { key: 'notifications.reassignedApproved' }
  if ((n.type === 'deliverable_reassigned' || n.type === 'deliverable_added') && d.no_tasks === true) {
    return { key: `notifications.noTasks.${n.type}` }
  }
  if (n.type === 'campaign_approved' && typeof d.no_tasks_count === 'number' && d.no_tasks_count > 0) {
    return d.no_tasks_count === d.deliverable_count
      ? { key: 'notifications.noTasks.campaign_approved_all' }
      : { key: 'notifications.noTasks.campaign_approved_some' }
  }
  // ADR-0134 d.18: the link's own expiry day, in the one date form (ADR-0127).
  if (n.type === 'link_expiring' && typeof d.expires_on === 'string') {
    return { key: 'notifications.type.link_expiring', vars: { date: formatCalendarDay(d.expires_on) } }
  }
  return { key: `notifications.type.${n.type}` }
}
