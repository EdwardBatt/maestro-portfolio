import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'

/**
 * The tenant's reminder and escalation rungs (ADR-0045 d.3, `tenant_reminder_settings`) — read
 * here for the sentences that quote them: "If Fadia has not assigned it within 24 hours it
 * escalates to the traffic manager on its own" (SJ-v3-04). A tenant with no row has the defaults.
 */
export interface ReminderSettings {
  briefApprovalHours: number
  assignmentEscalationHours: number
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { briefApprovalHours: 24, assignmentEscalationHours: 24 }

export function useReminderSettings() {
  return useQuery({
    queryKey: ['reminder-settings'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReminderSettings> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_reminder_settings')
        .select('brief_approval_hours, assignment_escalation_hours')
        .maybeSingle()
      if (error) throw error
      const r = data as { brief_approval_hours?: number; assignment_escalation_hours?: number } | null
      return {
        briefApprovalHours: r?.brief_approval_hours ?? DEFAULT_REMINDER_SETTINGS.briefApprovalHours,
        assignmentEscalationHours: r?.assignment_escalation_hours ?? DEFAULT_REMINDER_SETTINGS.assignmentEscalationHours,
      }
    },
  })
}
