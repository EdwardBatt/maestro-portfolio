import { fetchLeavingIds, withoutLeaving } from '../../../lib/people/leaving'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeRules, type ClientRule } from '../../../lib/brief/rules'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { useCreateBrand as useSharedCreateBrand, type NewBrand } from '../../../lib/brands'
import { clientCalendarKeys } from '../../../lib/calendar/client-calendar'
import { adminKeys } from '../../admin/api/admin-api'

/**
 * Client registration (ADR-0021, re-shaped by ADR-0123 — Figma section J).
 *
 * A client is a DRAFT from its first step and ACTIVE once the account director activates it (d.1); a
 * draft is never offered for work (d.2). It has a country, whose working week its work is counted by
 * (d.3), people at the client who are records rather than logins (d.4), and dos and don'ts that name
 * their languages and lock on activation (d.5). The database enforces all of it
 * (`app.client_lifecycle`); these hooks only say it.
 *
 * `clients.profile` keeps every field the old one-page form asked (what they sell, economics, the
 * e-commerce and app sections…). ADR-0123 d.6 stops asking them but never deletes them, so a write here
 * MERGES into the stored profile — only `businessTypes` and `rules` are ever written.
 *
 * Keys sit under adminKeys.all so a campaign submit (which invalidates adminKeys.all) refreshes the
 * counts here too.
 */

export const clientKeys = {
  all: [...adminKeys.all, 'clients-feature'] as const,
  list: () => [...clientKeys.all, 'list'] as const,
  brands: () => [...clientKeys.all, 'brands'] as const,
  contacts: (clientId: string) => [...clientKeys.all, 'contacts', clientId] as const,
  files: (clientId: string) => [...clientKeys.all, 'files', clientId] as const,
  countries: () => [...clientKeys.all, 'countries'] as const,
}

export const BUSINESS_TYPES = ['ecommerce', 'app', 'services', 'retail', 'telecom', 'other'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export type ClientStatus = 'draft' | 'active'

export interface ClientRow {
  id: string
  name: string
  status: ClientStatus
  countryCode: string | null
  businessTypes: BusinessType[]
  rules: ClientRule[]
  /** Default Account Manager for this client (ADR-0009). */
  accountManagerId: string | null
  accountManagerName: string | null
  /** Infrastructure, not a customer: the container ad-hoc work lives in. Never listed. */
  isInternal: boolean
  brandCount: number
  campaignCount: number
  createdAt: string
  createdById: string | null
  activatedAt: string | null
  activationRequestedAt: string | null
}

function businessTypesOf(profile: unknown): BusinessType[] {
  const raw = (profile as { businessTypes?: unknown } | null)?.businessTypes
  return Array.isArray(raw) ? raw.filter((b): b is BusinessType => (BUSINESS_TYPES as readonly string[]).includes(b)) : []
}

export function useClients() {
  return useQuery({
    queryKey: clientKeys.list(),
    queryFn: async (): Promise<ClientRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('clients')
        .select('id, name, status, country_code, profile, account_manager_id, is_internal, created_at, created_by, activated_at, activation_requested_at, account_manager:user_profiles!clients_account_manager_id_fkey(display_name), brands(count), campaigns(count)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as {
        id: string; name: string; status: ClientStatus; country_code: string | null; profile: unknown
        account_manager_id: string | null; is_internal: boolean
        created_at: string; created_by: string | null; activated_at: string | null; activation_requested_at: string | null
        account_manager: { display_name: string } | { display_name: string }[] | null
        brands: { count: number }[]; campaigns: { count: number }[]
      }[]
      return rows.map((c) => {
        const am = Array.isArray(c.account_manager) ? c.account_manager[0] : c.account_manager
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          countryCode: c.country_code,
          businessTypes: businessTypesOf(c.profile),
          rules: normalizeRules((c.profile as { rules?: unknown } | null)?.rules),
          accountManagerId: c.account_manager_id,
          accountManagerName: am?.display_name ?? null,
          isInternal: c.is_internal ?? false,
          brandCount: c.brands?.[0]?.count ?? 0,
          campaignCount: c.campaigns?.[0]?.count ?? 0,
          createdAt: c.created_at,
          createdById: c.created_by,
          activatedAt: c.activated_at,
          activationRequestedAt: c.activation_requested_at,
        }
      })
    },
  })
}

// ---- Countries (ADR-0123 d.3) ----

export interface Country {
  code: string
  nameEn: string
  nameAr: string
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workingDays: number[]
}

export function useCountries() {
  return useQuery({
    queryKey: clientKeys.countries(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Country[]> => {
      const { data, error } = await supabaseUntyped.from('countries').select('code, name_en, name_ar, working_days').order('sort_order').order('name_en')
      if (error) throw error
      return ((data ?? []) as { code: string; name_en: string; name_ar: string; working_days: number[] }[]).map((c) => ({
        code: c.code, nameEn: c.name_en, nameAr: c.name_ar, workingDays: c.working_days,
      }))
    },
  })
}

/** Users eligible to be a client's Account Manager — whoever holds `account_manager:manage` (ADR-0036),
 *  through the allowlisted RPC (ADR-0037). Active users only. */
export interface AccountManagerOption {
  id: string
  name: string
}
export function useAccountManagers() {
  return useQuery({
    queryKey: [...clientKeys.all, 'account-managers'] as const,
    queryFn: async (): Promise<AccountManagerOption[]> => {
      const { data, error } = await supabaseUntyped.rpc('users_holding_permission', {
        p_resource: 'account_manager',
        p_action: 'manage',
      })
      if (error) throw error
      const leaving = await fetchLeavingIds()   // ADR-0133 d.1: nobody Leaving is offered for new work.
      return withoutLeaving((data ?? []) as { id: string; name: string }[], leaving, (u) => u.id).map((u) => ({ id: u.id, name: u.name }))
    },
  })
}

function useInvalidateClients() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: clientKeys.all })
    void qc.invalidateQueries({ queryKey: ['campaigns'] }) // the client pickers in the wizards
    void qc.invalidateQueries({ queryKey: clientCalendarKeys.all })
  }
}

/** The stored profile, so a write keeps every key it does not own (ADR-0123 d.6). */
async function storedProfile(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseUntyped.from('clients').select('profile').eq('id', id).single()
  if (error) throw error
  const p = (data as { profile: unknown }).profile
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

export interface BasicsInput {
  name: string
  countryCode: string
  accountManagerId: string
  businessTypes: BusinessType[]
}

/**
 * The Basics step (CL-v3-01): the first save makes the draft — asked for as a draft outright, because
 * the column's default is `active` for the rows the system writes — and every later one updates it.
 * Returns the client's id.
 */
export function useSaveBasics() {
  const { claims } = useAuth()
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (args: { id: string | null } & BasicsInput): Promise<string> => {
      if (!args.id) {
        const { data, error } = await supabaseUntyped
          .from('clients')
          .insert({
            tenant_id: claims.tenantId,
            name: args.name.trim(),
            status: 'draft',
            country_code: args.countryCode,
            account_manager_id: args.accountManagerId,
            profile: { businessTypes: args.businessTypes, rules: [] },
          })
          .select('id')
          .single()
        if (error) throw error
        return (data as { id: string }).id
      }
      const profile = await storedProfile(args.id)
      const { error } = await supabaseUntyped
        .from('clients')
        .update({
          name: args.name.trim(),
          country_code: args.countryCode,
          account_manager_id: args.accountManagerId,
          profile: { ...profile, businessTypes: args.businessTypes },
        })
        .eq('id', args.id)
      if (error) throw error
      return args.id
    },
    onSuccess: invalidate,
  })
}

/** The dos and don'ts (CL-v3-04). On an active client only the account director may (d.5) — the
 *  database refuses anyone else with 42501. */
export function useSaveRules() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (args: { id: string; rules: ClientRule[] }) => {
      const profile = await storedProfile(args.id)
      const { error } = await supabaseUntyped.from('clients').update({ profile: { ...profile, rules: args.rules } }).eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Activate (CL-v3-06) — the account director's act; the database records who and when. */
export function useActivateClient() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('clients').update({ status: 'active' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** "Ask the director to activate" (CV-01): the directors are told by the database (20260928140000). */
export function useAskToActivate() {
  const { session } = useAuth()
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped
        .from('clients')
        .update({ activation_requested_at: new Date().toISOString(), activation_requested_by: session?.user.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteClient() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('clients').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ---- Brands (nested under a client; ADR-0022 folders, ADR-0123 d.7 short name) ----

export interface BrandRow {
  id: string
  name: string
  shortName: string | null
  clientId: string
  clientName: string
}

export function useBrands() {
  return useQuery({
    queryKey: clientKeys.brands(),
    queryFn: async (): Promise<BrandRow[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('brands')
        .select('id, name, short_name, client_id, clients(name)')
        .order('name')
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string; name: string; short_name: string | null; client_id: string
        clients: { name: string } | { name: string }[] | null
      }[]
      return rows.map((b) => {
        const cl = Array.isArray(b.clients) ? b.clients[0] : b.clients
        return { id: b.id, name: b.name, shortName: b.short_name, clientId: b.client_id, clientName: cl?.name ?? '' }
      })
    },
  })
}

/** The shared writer (`lib/brands.ts`) with this surface's own cache invalidation. */
export function useCreateBrand() {
  const create = useSharedCreateBrand()
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: (args: NewBrand) => create.mutateAsync(args),
    onSuccess: invalidate,
  })
}

export function useUpdateBrand() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (args: { id: string; name: string; shortName: string | null }) => {
      const { error } = await supabaseUntyped
        .from('brands')
        .update({ name: args.name.trim(), short_name: args.shortName?.trim() || null })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteBrand() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseUntyped.from('brands').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Per brand: its four folders (ADR-0022) with the files in each — the tiles on CL-v3-02 and CV-02. */
export interface BrandFolder {
  id: string
  name: string
  files: number
}
export interface BrandFiles {
  folders: BrandFolder[]
  files: number
}

export function useBrandFiles(clientId: string | null) {
  return useQuery({
    queryKey: clientKeys.files(clientId ?? 'none'),
    enabled: !!clientId,
    queryFn: async (): Promise<Map<string, BrandFiles>> => {
      const { data: folders, error } = await supabaseUntyped
        .from('asset_folders')
        .select('id, brand_id, kind, name, created_at')
        .eq('client_id', clientId!)
        .not('brand_id', 'is', null)
        .order('created_at')
      if (error) throw error
      const rows = (folders ?? []) as { id: string; brand_id: string; kind: string; name: string }[]
      const out = new Map<string, BrandFiles>()
      const folderOf = new Map<string, BrandFolder>()
      const brandOf = new Map<string, string>()
      for (const f of rows) {
        const b = out.get(f.brand_id) ?? { folders: [], files: 0 }
        out.set(f.brand_id, b)
        brandOf.set(f.id, f.brand_id)
        // The brand's own folder (`brand`) holds the four (`asset_type`); it is not one of them.
        if (f.kind !== 'asset_type') continue
        const folder = { id: f.id, name: f.name, files: 0 }
        b.folders.push(folder)
        folderOf.set(f.id, folder)
      }
      const ids = [...brandOf.keys()]
      if (ids.length) {
        const { data: assets, error: aErr } = await supabaseUntyped.from('assets').select('folder_id').in('folder_id', ids)
        if (aErr) throw aErr
        for (const a of (assets ?? []) as { folder_id: string }[]) {
          const b = out.get(brandOf.get(a.folder_id) ?? '')
          if (!b) continue
          b.files += 1
          const folder = folderOf.get(a.folder_id)
          if (folder) folder.files += 1
        }
      }
      return out
    },
  })
}

/** Every client's people, counted — the profile meter on the clients list (CV-01). */
export function useContactCounts() {
  return useQuery({
    queryKey: [...clientKeys.all, 'contact-counts'] as const,
    queryFn: async (): Promise<Map<string, { total: number; signsOff: number }>> => {
      const { data, error } = await supabaseUntyped.from('client_contacts').select('client_id, signs_off')
      if (error) throw error
      const out = new Map<string, { total: number; signsOff: number }>()
      for (const c of (data ?? []) as { client_id: string; signs_off: boolean }[]) {
        const n = out.get(c.client_id) ?? { total: 0, signsOff: 0 }
        n.total += 1
        if (c.signs_off) n.signsOff += 1
        out.set(c.client_id, n)
      }
      return out
    },
  })
}

// ---- The people at the client (ADR-0123 d.4) ----

export const REACH = ['whatsapp', 'email', 'phone'] as const
export type Reach = (typeof REACH)[number]

export interface ContactRow {
  id: string
  clientId: string
  name: string
  roleTitle: string | null
  reach: Reach[]
  canRequest: boolean
  signsOff: boolean
  isCopied: boolean
}

export function useClientContacts(clientId: string | null) {
  return useQuery({
    queryKey: clientKeys.contacts(clientId ?? 'none'),
    enabled: !!clientId,
    queryFn: async (): Promise<ContactRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('client_contacts')
        .select('id, client_id, name, role_title, reach, can_request, signs_off, is_copied')
        .eq('client_id', clientId!)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return ((data ?? []) as {
        id: string; client_id: string; name: string; role_title: string | null; reach: Reach[] | null
        can_request: boolean; signs_off: boolean; is_copied: boolean
      }[]).map((c) => ({
        id: c.id, clientId: c.client_id, name: c.name, roleTitle: c.role_title, reach: c.reach ?? [],
        canRequest: c.can_request, signsOff: c.signs_off, isCopied: c.is_copied,
      }))
    },
  })
}

export type ContactInput = Omit<ContactRow, 'id' | 'clientId'>

export function useAddContact() {
  const { claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { clientId: string; sortOrder: number } & ContactInput) => {
      const { error } = await supabaseUntyped
        .from('client_contacts')
        .insert({
          tenant_id: claims.tenantId,
          client_id: args.clientId,
          sort_order: args.sortOrder,
          name: args.name.trim(),
          role_title: args.roleTitle?.trim() || null,
          reach: args.reach,
          can_request: args.canRequest,
          signs_off: args.signsOff,
          is_copied: args.isCopied,
        })
      if (error) throw error
    },
    onSuccess: (_d, args) => void qc.invalidateQueries({ queryKey: clientKeys.contacts(args.clientId) }),
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; clientId: string } & ContactInput) => {
      const { error } = await supabaseUntyped
        .from('client_contacts')
        .update({
          name: args.name.trim(),
          role_title: args.roleTitle?.trim() || null,
          reach: args.reach,
          can_request: args.canRequest,
          signs_off: args.signsOff,
          is_copied: args.isCopied,
        })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: (_d, args) => void qc.invalidateQueries({ queryKey: clientKeys.contacts(args.clientId) }),
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; clientId: string }) => {
      const { error } = await supabaseUntyped.from('client_contacts').delete().eq('id', args.id)
      if (error) throw error
    },
    onSuccess: (_d, args) => void qc.invalidateQueries({ queryKey: clientKeys.contacts(args.clientId) }),
  })
}

/** Names for the people a screen mentions — who started a draft (CV-01). */
export function usePeopleNames(ids: readonly string[]) {
  const key = [...new Set(ids)].sort()
  return useQuery({
    queryKey: [...clientKeys.all, 'names', key.join(',')] as const,
    enabled: key.length > 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabaseUntyped.from('user_profiles').select('id, display_name').in('id', key)
      if (error) throw error
      return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map((u) => [u.id, u.display_name ?? '']))
    },
  })
}
