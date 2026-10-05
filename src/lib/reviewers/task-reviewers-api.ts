import { supabaseUntyped } from '../supabase'
import { inChunks } from '../query/in-chunks'
import type { ReviewerResponse, TaskReviewer } from './task-reviewers'

/**
 * Read the reviewer appointments on a set of tasks (ADR-0043), keyed by task id.
 *
 * In `src/lib/` rather than in a feature's `api/` because TWO features need the same read —
 * deliverables (My Work, the task table, the reviewer inbox) and schedule (the booking edit modal) —
 * and a feature may never import another feature's api internals (AGENTS.md §3). One reader, so the
 * two surfaces can never disagree about who is reviewing what.
 *
 * A FLAT select rather than an embed on `sub_tasks`. `sub_task_reviewers → user_profiles` is a
 * COMPOSITE foreign key, so the constraint has to be named; and an embed PostgREST cannot resolve
 * comes back EMPTY rather than as an error, which renders as "nobody is reviewing this" instead of
 * "the query is broken" — the footgun this project has been bitten by twice. `task-resources-api`
 * already proves this exact shape works over a composite FK.
 *
 * In BATCHES of ids (`inChunks`, I49.75): one request naming ~230 tasks in its address was refused
 * by the gateway as too long, and My Work showed "Could not load your assigned work".
 *
 * Kept apart from `task-reviewers.ts`: that module is pure data and safe for any test to import,
 * while this one reaches `lib/supabase` and therefore `lib/env`, which throws when the VITE_ vars
 * are absent (traps.md).
 */
export async function fetchTaskReviewers(subTaskIds: string[]): Promise<Map<string, TaskReviewer[]>> {
  const byTask = new Map<string, TaskReviewer[]>()
  if (subTaskIds.length === 0) return byTask

  const data = await inChunks<ReviewerRaw>(subTaskIds, (chunk) =>
    supabaseUntyped
      .from('sub_task_reviewers')
      .select(
        'sub_task_id, user_id, is_mandatory, approved_at, responded_at, response, ' +
          // ADR-0061 d.11: `is_active` so a reviewer who has since been deactivated is VISIBLE rather
          // than a name that quietly never approves.
          'user_profiles!fk_sub_task_reviewers_user(display_name, is_active)',
      )
      .in('sub_task_id', chunk),
  )

  for (const r of data) {
    const profile = Array.isArray(r.user_profiles) ? (r.user_profiles[0] ?? null) : r.user_profiles
    const list = byTask.get(r.sub_task_id) ?? []
    list.push({
      userId: r.user_id,
      name: profile?.display_name ?? null,
      isMandatory: r.is_mandatory,
      approvedAt: r.approved_at,
      // ADR-0089 d.5: an optional reviewer's answer, and what kind it was.
      respondedAt: r.responded_at,
      response: r.response,
      // Defaulted to active: a profile that failed to join is a query problem, and marking every
      // reviewer "deactivated" on a bad join would be a worse lie than the one this fixes.
      isActive: profile?.is_active ?? true,
    })
    byTask.set(r.sub_task_id, list)
  }
  return byTask
}

interface ReviewerRaw {
  sub_task_id: string
  user_id: string
  is_mandatory: boolean
  approved_at: string | null
  responded_at: string | null
  response: ReviewerResponse | null
  user_profiles: { display_name: string; is_active: boolean } | { display_name: string; is_active: boolean }[] | null
}
