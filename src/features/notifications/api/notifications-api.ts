import { useEffect } from 'react'
import { notificationLabel } from '../../../lib/notifications/label'
import { chimeForNotification, installChimePrimer } from '../../../lib/notifications/chime'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'

/**
 * In-app notifications API (ADR-0024/0026, I5). Recipient-scoped reads (RLS), a live subscription
 * to the caller's inbox topic, and mark-read. The DB is the source of truth — the broadcast just
 * invalidates so the list/badge refetch; a missed nudge is caught by the next read.
 */

/**
 * Must match the `notifications_type_check` constraint in the database.
 *
 * It had drifted: `cancelled` shipped on 24 Aug and was missing here AND from the locale file, so a
 * cancelled-task notice rendered as its raw key. Add a type to the DB check, this union, and both
 * locale files together, or it half-works.
 */
export type NotificationType =
  | 'assigned'
  | 'review_requested'
  | 'changes_requested'
  | 'signed_off'
  | 'due_soon'
  | 'dependency_ready'
  | 'cancelled'
  | 'resource_clash'
  | 'resource_required'
  /** 27 Aug (ADR-0048 d.8). Shipped into the DB check and added HERE and to the locales only on
   *  28 Aug — until then an approved-campaign notice rendered as its raw key, exactly as
   *  `cancelled` did on 24 Aug. The warning above this union was written before it happened again. */
  | 'campaign_approved'
  /** 28 Aug (ADR-0055 d.9); I52 Action 2 (17 Sep): the NEW owner. The old owner gets its own type. */
  | 'deliverable_reassigned'
  | 'deliverable_owner_removed'
  /** I52 Action 3: the person a task was taken from. */
  | 'task_reassigned_away'
  /** I52 Action 4: an OPTIONAL reviewer is asked for an answer, not an approval (ADR-0089). */
  | 'feedback_requested'
  | 'assignment_overdue'
  /** ADR-0089 d.9. The required reviewer, when the last optional reviewer has answered. */
  | 'feedback_collected'
  | 'rescheduled'
  | 'chat_added'
  | 'task_reinstated'
  /** ADR-0087 d.6–d.9: a booking request to the leads, and its answer to the requester. */
  | 'assignment_requested'
  | 'assignment_approved'
  | 'assignment_refused'
  | 'assignment_superseded'
  /** ADR-0088 d.9: a deadline extension to the account manager, and its answer back. */
  | 'extension_requested'
  | 'extension_approved'
  | 'extension_refused'
  /** ADR-0086 d.7: the target job's owner, when a duplicate is attached as a deliverable. */
  | 'deliverable_added'
  /** ADR-0103: a re-opened task (its assignee and reviewers) and deliverable (its owner). */
  | 'task_reopened'
  | 'deliverable_reopened'
  /** I59 (ADR-0105..0113), declared together in 20260926090000: a maker's block, an untimed round,
   *  the owner's forward of an extension, change requests, questions / nudges / too much, the
   *  configured escalations, the review reminder and over capacity. */
  | 'task_blocked'
  | 'untimed_round'
  | 'extension_forwarded'
  | 'change_request_sent'
  | 'change_request_answered'
  | 'change_request_resolved'
  | 'question_asked'
  | 'question_replied'
  | 'nudged'
  | 'too_much'
  | 'too_much_answered'
  | 'escalated'
  | 'review_reminder'
  | 'over_capacity'
  /** ADR-0107 addendum (I59 settled): a block was cleared — to whoever waited on it. */
  | 'task_unblocked'
  /** ADR-0123: a draft client's starter asked the account director to activate it. */
  | 'client_activation_requested'
  /** ADR-0132 d.3: someone other than the owner changed the deliverable's type; its task list was replaced. */
  | 'deliverable_type_changed'
  /** ADR-0132 d.2-d.3: someone other than the owner corrected the deliverable's quantity or due date. */
  | 'deliverable_edited'
  /** ADR-0133 d.2: a person is leaving — their work is listed for the department lead (or Traffic and the Power Admins). */
  | 'handover_list'
  /** ADR-0133 d.4: the hand-over list reached empty; the deactivation completed. */
  | 'deactivation_complete'
  /** ADR-0134 d.18 / ADR-0136 d.4 (I72): a link about to expire; an archived file back online. */
  | 'link_expiring'
  | 'file_brought_back'
  /** ADR-0139 d.4 (I74): a team lead's offer of other days; the offer taken; a request withdrawn. */
  | 'assignment_offered'
  | 'assignment_offer_taken'
  | 'assignment_withdrawn'
  /** ADR-0140 d.5 (I74): a booking cancelled — to the assignee and their lead. */
  | 'task_unassigned'
  /** ADR-0141 d.2–d.5 (I74): the one change form, and a maker's ask for more time. */
  | 'deliverable_change_asked'
  | 'deliverable_change_answered'
  | 'deliverable_change_withdrawn'
  | 'time_asked'
  | 'time_answered'
  // ADR-0117 addendum (Q20, 4 Oct): a deliverable's languages changed; to its translation task's assignee.
  | 'translation_languages_changed'

export interface AppNotification {
  id: string
  seq: number
  type: NotificationType
  label: string | null
  /** Matches `notifications_entity_type_check`. */
  entityType: 'deliverable' | 'sub_task' | 'campaign' | 'booking' | 'resource' | 'client' | null
  entityId: string | null
  readAt: string | null
  createdAt: string
  /** I52: the facts the emitter knew (see `notifications.detail`). Read for the door, not the words. */
  detail?: Record<string, unknown> | null
}

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unread: () => [...notificationKeys.all, 'unread'] as const,
}

/** The caller's most recent notifications (RLS scopes to the recipient). */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabaseUntyped
        .from('notifications')
        .select('id, seq, type, label, context_label, entity_type, entity_id, read_at, created_at, detail')
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return ((data ?? []) as {
        id: string; seq: number; type: NotificationType; label: string | null; context_label: string | null; detail?: Record<string, unknown> | null
        entity_type: AppNotification['entityType']; entity_id: string | null; read_at: string | null; created_at: string
      }[]).map((r) => ({
        id: r.id, seq: r.seq, type: r.type,
        label: notificationLabel(r.label, r.context_label),
        entityType: r.entity_type, entityId: r.entity_id, readAt: r.read_at, createdAt: r.created_at,
        detail: r.detail ?? null,
      }))
    },
  })
}

/** Unread count for the badge (head count — doesn't pull rows). */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabaseUntyped
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list() })
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() })
    },
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabaseUntyped.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list() })
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() })
    },
  })
}

/** Live inbox subscription — a new notification invalidates the list + badge (DB stays the truth).
 *  ADR-0113 d.4 (I59.28): one that asks for action chimes, if the person's switch is on and they
 *  have interacted with the page (the primer waits for their first click). */
export function useNotificationsChannel() {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  const uid = session?.user.id
  useEffect(() => {
    if (!uid || !claims.tenantId) return
    supabase.realtime.setAuth()
    installChimePrimer()
    const channel = supabase
      .channel(`tenant:${claims.tenantId}:user:${uid}`, { config: { private: true } })
      .on('broadcast', { event: 'notification' }, (msg: { payload?: { type?: unknown } }) => {
        chimeForNotification(msg?.payload?.type)
        void qc.invalidateQueries({ queryKey: notificationKeys.list() })
        void qc.invalidateQueries({ queryKey: notificationKeys.unread() })
      })
      // I67.10: a notice removed (its task list was approved) — reload, no chime.
      .on('broadcast', { event: 'notification_removed' }, () => {
        void qc.invalidateQueries({ queryKey: notificationKeys.list() })
        void qc.invalidateQueries({ queryKey: notificationKeys.unread() })
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [uid, claims.tenantId, qc])
}
