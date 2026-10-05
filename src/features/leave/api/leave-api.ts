import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { allRows } from '../../../lib/query/all-pages'
import { useAuth } from '../../../app/auth-context'

/**
 * Leave calendar (L1.7, ADR-0013). People & Culture record staff leave (incl.
 * emergency) and company holidays; both land as `resource_unavailability` rows
 * and surface on the booking grid. Writes are RLS-governed by the `leave:manage`
 * grant — org-wide when the caller's role is tenant-scoped (the default) — and
 * fenced to kind in ('leave','holiday'); audited by trigger. Untyped client:
 * `category` lags the generated types until `gen types` re-runs after db push.
 */

/**
 * 'holiday' is READ, never written, since ADR-0079: a holiday belongs to the office (below) and the
 * leave policy refuses the kind. Rows written before that stay listed rather than vanishing.
 */
export type LeaveKind = 'leave' | 'holiday'
export type LeaveCategory = 'planned' | 'emergency' | 'sick' | 'unpaid'

export const leaveKeys = {
  all: ['leave'] as const,
  entries: () => [...leaveKeys.all, 'entries'] as const,
  resources: () => [...leaveKeys.all, 'resources'] as const,
}

/** A person/resource leave or holiday can be recorded against. */
export interface LeaveResource {
  id: string
  name: string
  kind: string
}

export function useLeaveResources() {
  return useQuery({
    queryKey: leaveKeys.resources(),
    queryFn: async (): Promise<LeaveResource[]> => {
      const { data, error } = await supabaseUntyped
        .from('resources')
        .select('id, name, kind')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as LeaveResource[]
    },
  })
}

export interface LeaveEntry {
  id: string
  resourceId: string
  resourceName: string
  kind: LeaveKind
  category: LeaveCategory | null
  startsAt: string
  endsAt: string
  reason: string | null
}

export function useLeaveEntries() {
  return useQuery({
    queryKey: leaveKeys.entries(),
    queryFn: async (): Promise<LeaveEntry[]> => {
      // Every page (I59.35): every leave entry ever recorded, so it passes 1,000 within a year or two.
      const raw = await allRows((a, b) =>
        supabaseUntyped
          .from('resource_unavailability')
          .select('id, resource_id, kind, category, starts_at, ends_at, reason, resources(name)')
          .in('kind', ['leave', 'holiday'])
          .order('starts_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b))
      const rows = raw as unknown as {
        id: string
        resource_id: string
        kind: LeaveKind
        category: LeaveCategory | null
        starts_at: string
        ends_at: string
        reason: string | null
        resources: { name: string } | { name: string }[] | null
      }[]
      return rows.map((r) => {
        const res = Array.isArray(r.resources) ? r.resources[0] : r.resources
        return {
          id: r.id,
          resourceId: r.resource_id,
          resourceName: res?.name ?? '',
          kind: r.kind,
          category: r.category,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          reason: r.reason,
        }
      })
    },
  })
}

export interface LeaveWriteArgs {
  resourceId: string
  kind: LeaveKind
  category: LeaveCategory | null
  startsAt: string
  endsAt: string
  reason: string | null
}

function useInvalidateLeave() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: leaveKeys.entries() })
    void qc.invalidateQueries({ queryKey: ['schedule'] }) // the grid shows these rows
  }
}

export function useCreateLeave() {
  const { claims } = useAuth()
  const invalidate = useInvalidateLeave()
  return useMutation({
    mutationFn: async (args: LeaveWriteArgs) => {
      const { error } = await supabaseUntyped.from('resource_unavailability').insert({
        tenant_id: claims.tenantId,
        resource_id: args.resourceId,
        kind: args.kind,
        category: args.kind === 'leave' ? args.category : null,
        starts_at: args.startsAt,
        ends_at: args.endsAt,
        reason: args.reason?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateLeave() {
  const invalidate = useInvalidateLeave()
  return useMutation({
    mutationFn: async (args: { id: string } & LeaveWriteArgs) => {
      const { error } = await supabaseUntyped
        .from('resource_unavailability')
        .update({
          resource_id: args.resourceId,
          kind: args.kind,
          category: args.kind === 'leave' ? args.category : null,
          starts_at: args.startsAt,
          ends_at: args.endsAt,
          reason: args.reason?.trim() || null,
        })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteLeave() {
  const invalidate = useInvalidateLeave()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('resource_unavailability').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ---- Office closures (ADR-0079, I41.11 / I41.12) ----------------------------------------------
//
// A public holiday or a company-closed day belongs to the OFFICE, not to each person: one row per
// closure per office, and anyone hired after it was entered is covered. Reads are tenant-wide (the
// grid needs them); writes are `leave:manage`, the same HR grant as leave. Declaring one moves no
// booking (d.5) — `useStrandedBookings` lists what now sits on a closed day so a person can drag it.

export type ClosureKind = 'public_holiday' | 'company_closed'

export const closureKeys = {
  all: ['office-closures'] as const,
  list: () => [...closureKeys.all, 'list'] as const,
  stranded: (id: string) => [...closureKeys.all, 'stranded', id] as const,
  offices: () => [...closureKeys.all, 'offices'] as const,
}

export interface ClosureOffice {
  id: string
  name: string
}

export function useClosureOffices() {
  return useQuery({
    queryKey: closureKeys.offices(),
    queryFn: async (): Promise<ClosureOffice[]> => {
      const { data, error } = await supabaseUntyped.from('offices').select('id, name').order('name')
      if (error) throw error
      return (data ?? []) as ClosureOffice[]
    },
  })
}

export interface OfficeClosure {
  id: string
  officeId: string
  officeName: string
  kind: ClosureKind
  name: string
  /** `YYYY-MM-DD`, whole days in the office's calendar. */
  startsOn: string
  endsOn: string
}

export function useOfficeClosures() {
  return useQuery({
    queryKey: closureKeys.list(),
    queryFn: async (): Promise<OfficeClosure[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('office_closures')
        .select('id, office_id, kind, name, starts_on, ends_on, offices(name)')
        .order('starts_on', { ascending: false })
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string
        office_id: string
        kind: ClosureKind
        name: string
        starts_on: string
        ends_on: string
        offices: { name: string } | { name: string }[] | null
      }[]
      return rows.map((r) => {
        const o = Array.isArray(r.offices) ? r.offices[0] : r.offices
        return {
          id: r.id,
          officeId: r.office_id,
          officeName: o?.name ?? '',
          kind: r.kind,
          name: r.name,
          startsOn: r.starts_on,
          endsOn: r.ends_on,
        }
      })
    },
  })
}

export interface ClosureWriteArgs {
  officeId: string
  kind: ClosureKind
  name: string
  startsOn: string
  endsOn: string
}

function useInvalidateClosures() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: closureKeys.all })
    void qc.invalidateQueries({ queryKey: ['schedule'] }) // the grid shades these days
  }
}

export function useCreateClosure() {
  const { claims } = useAuth()
  const invalidate = useInvalidateClosures()
  return useMutation({
    mutationFn: async (args: ClosureWriteArgs): Promise<{ id: string }> => {
      const { data, error } = await supabaseUntyped
        .from('office_closures')
        .insert({
          tenant_id: claims.tenantId,
          office_id: args.officeId,
          kind: args.kind,
          name: args.name.trim(),
          starts_on: args.startsOn,
          ends_on: args.endsOn,
        })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: invalidate,
  })
}

export function useUpdateClosure() {
  const invalidate = useInvalidateClosures()
  return useMutation({
    mutationFn: async (args: { id: string } & ClosureWriteArgs): Promise<{ id: string }> => {
      const { error } = await supabaseUntyped
        .from('office_closures')
        .update({
          office_id: args.officeId,
          kind: args.kind,
          name: args.name.trim(),
          starts_on: args.startsOn,
          ends_on: args.endsOn,
        })
        .eq('id', args.id)
      if (error) throw error
      return { id: args.id }
    },
    onSuccess: invalidate,
  })
}

export function useDeleteClosure() {
  const invalidate = useInvalidateClosures()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('office_closures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** A booking that now sits on a closed day (ADR-0079 d.6). */
export interface StrandedBooking {
  bookingId: string
  resourceId: string
  resourceName: string
  title: string | null
  startsAt: string
  endsAt: string
  deliverableName: string | null
  ownerName: string | null
}

export function useStrandedBookings(closureId: string | null) {
  return useQuery({
    queryKey: closureKeys.stranded(closureId ?? 'none'),
    enabled: !!closureId,
    queryFn: async (): Promise<StrandedBooking[]> => {
      const { data, error } = await supabaseUntyped.rpc('office_closure_stranded_bookings', { p_closure: closureId })
      if (error) throw error
      const rows = (data ?? []) as {
        booking_id: string
        resource_id: string
        resource_name: string
        title: string | null
        starts_at: string
        ends_at: string
        deliverable_name: string | null
        owner_name: string | null
      }[]
      return rows.map((r) => ({
        bookingId: r.booking_id,
        resourceId: r.resource_id,
        resourceName: r.resource_name,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        deliverableName: r.deliverable_name,
        ownerName: r.owner_name,
      }))
    },
  })
}
