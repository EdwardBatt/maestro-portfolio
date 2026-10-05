import { useWorkCalendar, type WorkRef } from '../calendar/client-calendar.ts'
import { DEFAULT_SCHEDULING_SETTINGS, useSchedulingSettings } from '../settings/scheduling-settings-api.ts'

/**
 * What `classifyExtension` needs beyond the request itself (I41.10 / I41.11): the tenant's review
 * buffer instead of the constant, and the CLIENT's working week (ADR-0123 d.3) with the office's
 * closures instead of the Iraq default. Both surfaces that judge an extension read it through here so they cannot drift.
 */
export function useExtensionContext(work: WorkRef) {
  const settings = useSchedulingSettings()
  const { calendar } = useWorkCalendar(work)
  return {
    reviewBufferWorkingDays: (settings.data ?? DEFAULT_SCHEDULING_SETTINGS).reviewBufferWorkingDays,
    workingDays: calendar.workingDays,
    closures: calendar.closures,
  }
}
