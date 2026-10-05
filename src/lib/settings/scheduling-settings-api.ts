import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { useAuth } from '../../app/auth-context'
import { DEFAULT_GO_LIVE_RULE, type GoLiveRule } from '../campaigns/go-live-dates.ts'
import { DEFAULT_REVIEW_BUFFER_DAYS } from '../deadlines/extension-arithmetic.ts'

/**
 * The scheduling numbers (I41.10, ADR-0075 d.5) — read by every screen that derives or judges a
 * date, written by Admin → Organization behind `organization:manage`.
 *
 * Lives in `lib/`, not a feature, because three features read it (campaigns, deliverables, admin)
 * and a feature never imports another feature's internals. The row is `tenant_reminder_settings`
 * (ADR-0066 d.8's home for per-tenant thresholds), one per tenant, seeded at provisioning — so a
 * missing row is a provisioning defect, and the defaults returned in that case are the measured
 * ones rather than zeros.
 */

export interface SchedulingSettings {
  rule: GoLiveRule
  reviewBufferWorkingDays: number
}

export const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = {
  rule: DEFAULT_GO_LIVE_RULE,
  reviewBufferWorkingDays: DEFAULT_REVIEW_BUFFER_DAYS,
}

export const schedulingSettingsKeys = {
  all: ['scheduling-settings'] as const,
}

export function useSchedulingSettings() {
  return useQuery({
    queryKey: schedulingSettingsKeys.all,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SchedulingSettings> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_reminder_settings')
        .select('delivery_days_before_go_live, commence_days_before_delivery, review_buffer_working_days')
        .maybeSingle()
      if (error) throw error
      const row = data as {
        delivery_days_before_go_live: number
        commence_days_before_delivery: number
        review_buffer_working_days: number
      } | null
      if (!row) return DEFAULT_SCHEDULING_SETTINGS
      return {
        rule: {
          deliveryDaysBeforeGoLive: row.delivery_days_before_go_live,
          commenceDaysBeforeDelivery: row.commence_days_before_delivery,
        },
        reviewBufferWorkingDays: row.review_buffer_working_days,
      }
    },
  })
}

export function useUpdateSchedulingSettings() {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (next: SchedulingSettings) => {
      const { data, error } = await supabaseUntyped
        .from('tenant_reminder_settings')
        .update({
          delivery_days_before_go_live: next.rule.deliveryDaysBeforeGoLive,
          commence_days_before_delivery: next.rule.commenceDaysBeforeDelivery,
          review_buffer_working_days: next.reviewBufferWorkingDays,
        })
        .eq('tenant_id', claims.tenantId)
        .select('tenant_id')
      if (error) throw error
      // RLS filters the row out for somebody without organization:manage and the UPDATE touches
      // nothing — no error, "saved". Zero rows back IS the refusal (traps.md), said as one.
      if (!data || (data as unknown[]).length === 0) {
        throw Object.assign(new Error('changing the scheduling rules requires organization:manage'), { code: '42501' })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingSettingsKeys.all })
    },
  })
}
