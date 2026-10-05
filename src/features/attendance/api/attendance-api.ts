import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { viewAsStore } from '../../../lib/view-as'

/**
 * Workday attendance API (ADR-0031, I9). Reads the signed-in person's own attendance day + the
 * tenant's expected-attendance profile + today's deviation flags, and drives check-in/out through
 * the public wrappers over the app.* lifecycle functions. All reads are RLS-scoped to the caller.
 */

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: (userId: string | null) => [...attendanceKeys.all, 'today', userId ?? 'none'] as const,
  profile: () => [...attendanceKeys.all, 'profile'] as const,
  deviation: (userId: string | null, date: string) => [...attendanceKeys.all, 'deviation', userId ?? 'none', date] as const,
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface AttendanceDay {
  id: string
  workDate: string
  checkedInAt: string | null
  checkedOutAt: string | null
  checkInSource: 'auto' | 'explicit' | null
  checkOutSource: 'explicit' | 'inferred' | null
  workedMinutes: number | null
}

export interface AttendanceProfile {
  expectedCheckIn: string | null
  expectedMinutes: number | null
  graceMinutes: number
  workdays: number[]
}

export interface AttendanceDeviation {
  late: boolean
  short: boolean
  missing: boolean
  noCheckout: boolean
  suppressed: boolean
}

/** The signed-in person's attendance row for today (RLS: self). */
export function useMyAttendanceToday(userId: string | null) {
  return useQuery({
    queryKey: attendanceKeys.today(userId),
    enabled: !!userId,
    queryFn: async (): Promise<AttendanceDay | null> => {
      const { data, error } = await supabaseUntyped
        .from('attendance_days')
        .select('id, work_date, checked_in_at, checked_out_at, check_in_source, check_out_source, worked_minutes')
        .eq('user_id', userId!)
        .eq('work_date', todayISO())
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as {
        id: string; work_date: string; checked_in_at: string | null; checked_out_at: string | null
        check_in_source: AttendanceDay['checkInSource']; check_out_source: AttendanceDay['checkOutSource']; worked_minutes: number | null
      }
      return {
        id: r.id, workDate: r.work_date, checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at,
        checkInSource: r.check_in_source, checkOutSource: r.check_out_source, workedMinutes: r.worked_minutes,
      }
    },
  })
}

/** The tenant's default attendance expectation (tenant-wide read). */
export function useAttendanceProfile() {
  return useQuery({
    queryKey: attendanceKeys.profile(),
    queryFn: async (): Promise<AttendanceProfile | null> => {
      const { data, error } = await supabaseUntyped
        .from('attendance_profiles')
        .select('expected_check_in, expected_minutes, grace_minutes, workdays')
        .eq('is_default', true)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as { expected_check_in: string | null; expected_minutes: number | null; grace_minutes: number; workdays: number[] }
      return { expectedCheckIn: r.expected_check_in, expectedMinutes: r.expected_minutes, graceMinutes: r.grace_minutes, workdays: r.workdays }
    },
  })
}

/** Today's deviation flags for the signed-in person (public.attendance_deviation, RLS-scoped). */
export function useMyDeviation(userId: string | null) {
  const date = todayISO()
  return useQuery({
    queryKey: attendanceKeys.deviation(userId, date),
    enabled: !!userId,
    queryFn: async (): Promise<AttendanceDeviation | null> => {
      const { data, error } = await supabaseUntyped.rpc('attendance_deviation', { p_user: userId!, p_date: date })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as
        | { late: boolean; short: boolean; missing: boolean; no_checkout: boolean; suppressed: boolean }
        | undefined
      if (!row) return null
      return { late: row.late, short: row.short, missing: row.missing, noCheckout: row.no_checkout, suppressed: row.suppressed }
    },
  })
}

function useAttendanceAction(fn: 'attendance_start_day' | 'attendance_end_day') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabaseUntyped.rpc(fn, {})
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: attendanceKeys.all }),
  })
}

/** Explicit "Start day" (promotes an auto check-in to explicit). */
export const useStartDay = () => useAttendanceAction('attendance_start_day')
/** Explicit "End day". */
export const useEndDay = () => useAttendanceAction('attendance_end_day')

/** Fire the heartbeat once when the page mounts — the auto check-in + last-activity mark.
 *  Best-effort: a failure is swallowed (the inbox/day row stay the source of truth). */
export function useAttendanceHeartbeat(userId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    // ADR-0120: a Power Admin viewing as someone must not check them in (the database refuses it anyway).
    if (!userId || viewAsStore.userId) return
    void supabaseUntyped
      .rpc('attendance_heartbeat', {})
      .then(() => qc.invalidateQueries({ queryKey: attendanceKeys.today(userId) }))
      .then(() => qc.invalidateQueries({ queryKey: attendanceKeys.deviation(userId, todayISO()) }))
  }, [userId, qc])
}
