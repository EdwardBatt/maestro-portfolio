import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { deliverableKeys } from './deliverables-api'

/**
 * The reads the task page (I59.11, Figma M2 / M4) makes beyond the task itself. Read-only, on the
 * existing tables under their existing RLS; nothing here writes.
 *
 * The campaign reads it shares with other screens — the brief, the receipt, the References folder
 * and its files — live in `src/lib/campaigns/piece-reads.ts` (I59 Track 6, AGENTS.md §3) and are
 * re-exported here, so the page and My Work's chips import them as before.
 */
export {
  fetchReferenceDownloadUrl,
  useAssetUrl,
  useCampaignReferencesFolderId,
  useReferenceFiles,
  useTaskBrief,
  useTaskReceipt,
  type ReferenceFile,
  type TaskBriefField,
  type TaskReceipt,
} from '../../../lib/campaigns/piece-reads'

const taskPageKeys = {
  timer: (subTaskId: string, round: number) => [...deliverableKeys.all, 'task-timer', subTaskId, round] as const,
}

// ------------------------------------------------------------------------- the timer ----

export interface TaskTimer {
  startedAt: string | null
  submittedAt: string | null
  minutes: number | null
  /** ADR-0107 d.3: the round's blocked minutes, recorded when it was sent (null before ADR-0107). */
  blockedMinutes?: number | null
  /** ADR-0106 d.3: the round was sent untimed, so `minutes` is the allocation. */
  untimed?: boolean
}

/**
 * This round's time entry (ADR-0030): when Start was pressed and, once sent, the minutes recorded
 * (less the blocked minutes, ADR-0107 d.3) and whether it was untimed (ADR-0106). While it runs,
 * the page reads the figures so far from `task_round_timing` (`useRoundTiming`); nothing is
 * recorded from here.
 */
export function useTaskTimer(subTaskId: string | null, round: number) {
  return useQuery({
    queryKey: taskPageKeys.timer(subTaskId ?? 'none', round),
    enabled: !!subTaskId,
    queryFn: async (): Promise<TaskTimer | null> => {
      const { data, error } = await supabaseUntyped
        .from('task_time_entries')
        .select('started_at, submitted_at, minutes, blocked_minutes, untimed')
        .eq('sub_task_id', subTaskId!)
        .eq('round', round)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as {
        started_at: string | null; submitted_at: string | null; minutes: number | null
        blocked_minutes: number | null; untimed: boolean | null
      }
      return {
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
        minutes: r.minutes == null ? null : Number(r.minutes),
        blockedMinutes: r.blocked_minutes == null ? null : Number(r.blocked_minutes),
        untimed: r.untimed === true,
      }
    },
  })
}
