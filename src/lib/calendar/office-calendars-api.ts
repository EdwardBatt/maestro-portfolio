import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { officeCalendarFromRow, type OfficeRowWithClosures } from '../capacity/closures.ts'
import type { OfficeCalendar } from '../capacity/types.ts'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../campaigns/go-live-dates.ts'

/**
 * Every office's calendar — weekly pattern plus closures — for the screens that derive a date
 * without a resource in hand (the campaign wizard, the due-date dialog). The schedule and the
 * booking dialogs get theirs from the resource row instead (ADR-0005: every surface reads THAT
 * office's), and the Edge Functions read the same embed server-side. One read, cached for the
 * session, invalidated by the leave page when a closure is written.
 */
export interface OfficeCalendarRow extends OfficeCalendar {
  id: string
  name: string
}

export const officeCalendarKeys = {
  all: ['office-calendars'] as const,
}

export function useOfficeCalendars() {
  return useQuery({
    queryKey: officeCalendarKeys.all,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OfficeCalendarRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('offices')
        .select('id, name, timezone, working_days, office_closures(starts_on, ends_on)')
        .order('name')
      if (error) throw error
      const rows = (data ?? []) as unknown as ({ id: string; name: string } & OfficeRowWithClosures)[]
      return rows.map((r) => ({ id: r.id, name: r.name, ...officeCalendarFromRow(r) }))
    },
  })
}

/**
 * The calendar to plan a CAMPAIGN by, when no single resource is in hand.
 *
 * A campaign has no office; its deliverables are made by whichever offices own the people. The
 * honest choice with nothing to go on is the tenant's first office (alphabetical, and for the
 * pilot the only one), falling back to Iraq's Sunday–Thursday with no closures when the read has
 * not landed. A wrong-office date is corrected by the person typing; a Friday deadline is not.
 */
export function usePlanningCalendar(): { calendar: WorkingCalendar; office: OfficeCalendarRow | null; isLoading: boolean } {
  const offices = useOfficeCalendars()
  const office = offices.data?.[0] ?? null
  return {
    calendar: office ? { workingDays: office.workingDays, closures: office.closures } : IRAQ_WORKING_CALENDAR,
    office,
    isLoading: offices.isLoading,
  }
}
