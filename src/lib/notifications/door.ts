/**
 * **Where a notification sends its reader** — one table for the email's button (`notify-email`) and
 * the in-app bell (`NotificationInbox`), so the two cannot disagree (I59.45).
 *
 * Edward, 26 Sep: *"All emails sent must provide accurate links to the action required. e.g an email on
 * approval opens the approval page, a review opens the review page."* Checked that day: about half the
 * doors had drifted when I59 moved the work. Task lists are approved on the campaign page, not on
 * `/deliverables` (which cannot approve them and is closed to anyone without `project_tasks:manage`);
 * a maker's own task has its page (ADR-0105 d.3); and what a person answers — a question, a block, a
 * "too much", an extension at their step, a change request, an escalation — is a card in Needs you.
 *
 * The doors:
 *  - **the task page** `/my-work/task/<task>` — the maker's own task, and anything read about a task
 *    (it opens for anyone; a non-assignee sees "not yours");
 *  - **a Needs you card** `/my-work?task=<id>&kind=<kind>` — My Work scrolls to that card and marks it;
 *    `<id>` is the task, deliverable, person or notification the card is about;
 *  - **the campaign page** — task lists to approve (its panel), and a deliverable read about.
 *    Given only a deliverable, `/campaigns/piece/<deliverable>` looks its campaign up and goes there;
 *  - **the Schedule** — assigning, bookings and clashes. Those doors carry the week and the person,
 *    which each caller works out itself, so they are returned as `null` here and the caller keeps them;
 *  - **the chat group** for `chat_added`.
 *
 * No imports: `notify-email` loads this file from Deno as it is.
 */
export interface DoorNotification {
  id: string
  type: string
  entityType: string | null
  entityId: string | null
  detail: Record<string, unknown> | null
}

/** What only the server knows cheaply. The bell passes nothing and gets the lookup door instead. */
export interface DoorFacts {
  /** The campaign a deliverable (or a task's deliverable) belongs to. */
  campaignId?: string | null
  /** Its department — the Schedule's assign door opens on it. */
  departmentId?: string | null
}

/** Types whose door is the Schedule with a week and a person — the caller's own (see above). */
export const SCHEDULE_DOORS = new Set([
  'resource_clash', 'resource_required', 'rescheduled', 'task_reinstated',
  'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
])

/** The maker's own task, or something to read about a task: its page. */
const TASK_PAGE = new Set([
  'assigned', 'changes_requested', 'signed_off', 'extension_approved', 'extension_refused',
  'task_unblocked', 'too_much_answered', 'nudged', 'question_replied', 'untimed_round',
  'translation_languages_changed',
])

/** A reviewer's turn: the review card in Needs you. */
const REVIEW = new Set(['review_requested', 'feedback_requested', 'feedback_collected', 'review_reminder'])

/** About a deliverable, to approve its task list or to read: the campaign page. */
const CAMPAIGN_PAGE = new Set([
  'deliverable_added', 'deliverable_reassigned', 'deliverable_owner_removed', 'deliverable_reopened',
  'campaign_approved', 'change_request_resolved', 'deliverable_type_changed', 'deliverable_edited',
])

export const taskPage = (taskId: string) => `/my-work/task/${taskId}`
export const needsYouCard = (id: string, kind: string) =>
  `/my-work?task=${encodeURIComponent(id)}&kind=${encodeURIComponent(kind)}`
// ADR-0132 d.6: the campaign page with that piece's panel open (`src/lib/navigation/piece-link.ts` builds the
// same address; this file may not import it).
const piece = (deliverableId: string, f: DoorFacts) =>
  f.campaignId ? `/campaigns/${f.campaignId}?piece=${deliverableId}` : `/campaigns/piece/${deliverableId}`
const assign = (f: DoorFacts) => {
  if (!f.campaignId) return '/schedule'
  const q = new URLSearchParams({ campaign: f.campaignId })
  if (f.departmentId) q.set('dept', f.departmentId)
  return `/schedule?${q.toString()}`
}
const str = (v: unknown) => (typeof v === 'string' ? v : null)

/**
 * The path (no origin) a notification opens, or `null` for a Schedule door the caller builds.
 * Never throws and never returns an empty string: an unknown type falls back to My Work.
 */
export function notificationDoor(n: DoorNotification, facts: DoorFacts = {}): string | null {
  if (SCHEDULE_DOORS.has(n.type)) return null
  const id = n.entityId
  const task = n.entityType === 'sub_task' ? id : null
  const deliverable = n.entityType === 'deliverable' ? id : null
  const d = n.detail ?? {}

  if (n.type === 'chat_added' && n.entityType && id) return `/chat?type=${n.entityType}&id=${id}`

  if (task && TASK_PAGE.has(n.type)) return taskPage(task)
  if (task && REVIEW.has(n.type)) return needsYouCard(task, 'review')

  // "You can start": the maker's task — or, sent to the owner because nobody has it, assign it.
  if (n.type === 'dependency_ready' && task) return d.unassigned === true ? assign(facts) : taskPage(task)
  // Re-opened: back to the maker; a reviewer has nothing to do until it is done again.
  if (n.type === 'task_reopened' && task) return d.for_reviewer === true ? '/my-work' : taskPage(task)
  if (n.type === 'task_reassigned_away' || n.type === 'cancelled') return '/my-work'

  // Answered on a Needs you card.
  if (n.type === 'question_asked' && task) return needsYouCard(task, 'question')
  if (n.type === 'too_much' && task) return needsYouCard(task, 'too_much')
  if (n.type === 'task_blocked' && task) return needsYouCard(task, 'blocked')
  if (n.type === 'extension_requested' && task) return needsYouCard(task, str(d.stage) === 'owner' ? 'extension_owner' : 'extension_am')
  if (n.type === 'extension_forwarded' && task) return needsYouCard(task, 'extension_am')
  if (n.type === 'change_request_sent' && deliverable) return needsYouCard(deliverable, 'change_request')
  if (n.type === 'change_request_answered' && deliverable) {
    const a = str(d.answer)   // 'accept' | 'decline' | 'push_back' (change_request_answer)
    if (a === 'decline') return needsYouCard(deliverable, 'change_declined')
    if (a === 'push_back') return needsYouCard(deliverable, 'change_pushed_back')
    return piece(deliverable, facts)   // accepted: applied, nothing to answer
  }
  // ADR-0134 d.18 / ADR-0136 d.4: the file's own folder in the Library, with the file picked out.
  if ((n.type === 'link_expiring' || n.type === 'file_brought_back') && str(d.client_id) && str(d.folder_id)) {
    const q = new URLSearchParams({ client: str(d.client_id)!, folder: str(d.folder_id)! })
    if (str(d.asset_id)) q.set('file', str(d.asset_id)!)
    return `/library?${q.toString()}`
  }
  if (n.type === 'escalated') return needsYouCard(n.id, 'escalated')
  if (n.type === 'over_capacity' && id) return needsYouCard(id, 'over_capacity')
  // The older "nobody assigned yet" escalation: assign it.
  if (n.type === 'assignment_overdue') return assign(facts)

  if (deliverable && CAMPAIGN_PAGE.has(n.type)) return piece(deliverable, facts)
  if (n.entityType === 'campaign' && id) return `/campaigns/${id}`
  // ADR-0133 (I70.3, I70.5): a leaving person's hand-over — the list to work through, or its completion — opens
  // that person's hand-over page. The person is the entity, or `detail.user_id` when the notice names another.
  if (n.type === 'handover_list' || n.type === 'deactivation_complete') {
    const who = str(d.user_id) ?? (n.entityType === 'user_profile' || n.entityType === 'user_profiles' ? id : null)
    return who ? `/people/handover/${who}` : '/my-work'
  }
  // ADR-0123: a draft waiting for the director opens on its Review step, where Activate is.
  if (n.type === 'client_activation_requested' && id) return `/clients/${id}/register?step=6`
  if (deliverable) return piece(deliverable, facts)
  if (task) return taskPage(task)
  return '/my-work'
}
