import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './auth-context'
import { invalidateTaskViews } from '../lib/query/task-views'

/** A burst of changes (a task list approved, a campaign's bookings rewritten) arrives as a burst of nudges. */
export const WORK_NUDGE_DEBOUNCE_MS = 500

/**
 * One refresh per quiet spell: the first nudge starts a timer, later ones within it fold in, and the views are
 * refreshed once when it runs out. Split out so the timing is testable without a socket.
 */
export function debouncedTaskViewRefresh(qc: QueryClient, wait = WORK_NUDGE_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    nudge() {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        invalidateTaskViews(qc)
      }, wait)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

/**
 * I67.2: every open screen hears when anyone in the organisation changes a task or a booking, and re-reads its own
 * task and booking views under its own permissions. The database nudges the tenant's private topic
 * `tenant:{tid}:work` once per statement (migration `20260930110000`); the nudge carries the table and the
 * operation only, never row data, and only the tenant's active members may receive it. Subscribed once, in the
 * app shell.
 */
export function useWorkChannel() {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  const uid = session?.user.id
  useEffect(() => {
    if (!uid || !claims.tenantId) return
    supabase.realtime.setAuth()
    const refresh = debouncedTaskViewRefresh(qc)
    const channel = supabase
      .channel(`tenant:${claims.tenantId}:work`, { config: { private: true } })
      .on('broadcast', { event: 'work_changed' }, () => refresh.nudge())
      .subscribe()
    return () => {
      refresh.cancel()
      void supabase.removeChannel(channel)
    }
  }, [uid, claims.tenantId, qc])
}
