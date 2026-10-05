import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { APP_VERSION } from '../../../lib/version'

/**
 * Product feedback (alpha launch). Submitting is a DIRECT PostgREST insert
 * governed by RLS: any signed-in user may file feedback for their own tenant,
 * as themselves (the insert policy pins submitted_by = auth.uid()). Reading is
 * admin-only (admin.feedback:view) — the list hook returns [] for anyone else
 * because RLS filters it. The universal audit trigger logs every submission.
 */

export const feedbackKeys = {
  all: ['feedback'] as const,
  list: () => [...feedbackKeys.all, 'list'] as const,
}

export type FeedbackCategory = 'bug' | 'idea' | 'other'
export type FeedbackStatus = 'open' | 'resolved'

export interface SubmitFeedbackArgs {
  category: FeedbackCategory
  message: string
  pagePath: string
}

export function useSubmitFeedback() {
  const { session, claims } = useAuth()
  return useMutation({
    mutationFn: async (args: SubmitFeedbackArgs) => {
      const { error } = await supabaseUntyped.from('app_feedback').insert({
        tenant_id: claims.tenantId,
        submitted_by: session?.user.id,
        category: args.category,
        message: args.message.trim(),
        page_path: args.pagePath,
        app_version: APP_VERSION,
      })
      if (error) throw error
    },
  })
}

export interface FeedbackRow {
  id: string
  createdAt: string
  category: FeedbackCategory
  message: string
  pagePath: string | null
  appVersion: string | null
  submitterName: string | null
  status: FeedbackStatus
  resolutionNote: string | null
  resolvedAt: string | null
  resolverName: string | null
}

/** Admin-only list. RLS returns nothing to callers without admin.feedback:view,
 * so the hook is safe to mount anywhere; the Power Admin screen is its home. */
export function useFeedbackSubmissions() {
  return useQuery({
    queryKey: feedbackKeys.list(),
    queryFn: async (): Promise<FeedbackRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('app_feedback')
        .select(
          'id, created_at, category, message, page_path, app_version, status, resolution_note, resolved_at,' +
            ' submitter:user_profiles!submitted_by(display_name),' +
            ' resolver:user_profiles!resolved_by(display_name)',
        )
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string
        created_at: string
        category: FeedbackCategory
        message: string
        page_path: string | null
        app_version: string | null
        status: FeedbackStatus
        resolution_note: string | null
        resolved_at: string | null
        submitter: { display_name: string } | null
        resolver: { display_name: string } | null
      }[]
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        category: r.category,
        message: r.message,
        pagePath: r.page_path,
        appVersion: r.app_version,
        submitterName: r.submitter?.display_name ?? null,
        status: r.status,
        resolutionNote: r.resolution_note,
        resolvedAt: r.resolved_at,
        resolverName: r.resolver?.display_name ?? null,
      }))
    },
  })
}

export interface ResolveFeedbackArgs {
  id: string
  /** target state — 'resolved' records the action-taken note; 'open' reopens. */
  status: FeedbackStatus
  /** action-taken note, saved only when resolving. */
  resolutionNote?: string
}

/**
 * Triage a feedback item (ADR-0008 admin.feedback:manage). Resolving records an
 * optional action-taken note; the resolver identity + timestamp are stamped
 * server-side by the guard trigger, so we never send them. Reopening clears the
 * resolution server-side. RLS returns 403 to anyone without the manage ability.
 */
export function useResolveFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: ResolveFeedbackArgs) => {
      const patch =
        args.status === 'resolved'
          ? { status: 'resolved', resolution_note: args.resolutionNote?.trim() || null }
          : { status: 'open' }
      const { error } = await supabaseUntyped.from('app_feedback').update(patch).eq('id', args.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.list() }),
  })
}
