import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../supabase'
import { officeCalendarFromRow, type OfficeRowWithClosures } from '../capacity/closures.ts'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../campaigns/go-live-dates.ts'

/**
 * The client's calendar (ADR-0123 d.3) — the week a client's work is due by.
 *
 * A client has a country and a country has its working week (`countries.working_days`: Iraq Sunday to
 * Thursday, the UAE Monday to Friday, …). For that client's jobs and campaigns the country's week is
 * the calendar of the lead time, the plan back from a go-live, the due dates, the at-risk and late
 * checks and the extension arithmetic. People's own capacity stays on their office's week (ADR-0005)
 * and is not read from here.
 *
 * The office's CLOSURES still apply (ADR-0079): the days the office is shut, nothing is delivered,
 * whichever week the client keeps. Public holidays per country are not decided (ADR-0123).
 *
 * Read FLAT — clients, countries, the first office — and joined here: an embed PostgREST cannot
 * resolve comes back empty rather than as an error. Cached for the session.
 */

/** The country's week with the office's closures; the office's week when the client has no country;
 *  Iraq's when neither is known. */
export function clientCalendar(
  countryDays: readonly number[] | null | undefined,
  office: WorkingCalendar | null | undefined,
): WorkingCalendar {
  const workingDays = countryDays && countryDays.length > 0 ? countryDays : office?.workingDays ?? IRAQ_WORKING_CALENDAR.workingDays
  return office?.closures?.length ? { workingDays, closures: office.closures } : { workingDays }
}

export interface ClientCalendars {
  /** Client id → its calendar. */
  byClient: ReadonlyMap<string, WorkingCalendar>
  /** Client id → its country code, for the "IRAQ · SUN–THU" chip. */
  countryOf: ReadonlyMap<string, string>
  /** The calendar for work with no client in hand. */
  fallback: WorkingCalendar
}

export async function readClientCalendars(): Promise<ClientCalendars> {
  const [clientsRes, countriesRes, officesRes] = await Promise.all([
    supabaseUntyped.from('clients').select('id, country_code'),
    supabaseUntyped.from('countries').select('code, working_days'),
    supabaseUntyped.from('offices').select('timezone, working_days, office_closures(starts_on, ends_on)').order('name').limit(1),
  ])
  if (clientsRes.error) throw clientsRes.error
  if (countriesRes.error) throw countriesRes.error
  if (officesRes.error) throw officesRes.error
  const officeRow = ((officesRes.data ?? []) as unknown as OfficeRowWithClosures[])[0]
  const office: WorkingCalendar | null = officeRow ? officeCalendarFromRow(officeRow) : null
  const daysOf = new Map(((countriesRes.data ?? []) as { code: string; working_days: number[] }[]).map((c) => [c.code, c.working_days]))
  const byClient = new Map<string, WorkingCalendar>()
  const countryOf = new Map<string, string>()
  for (const c of (clientsRes.data ?? []) as { id: string; country_code: string | null }[]) {
    byClient.set(c.id, clientCalendar(c.country_code ? daysOf.get(c.country_code) : null, office))
    if (c.country_code) countryOf.set(c.id, c.country_code)
  }
  return { byClient, countryOf, fallback: clientCalendar(null, office) }
}

export const clientCalendarKeys = { all: ['client-calendars'] as const }

export function useClientCalendars() {
  return useQuery({ queryKey: clientCalendarKeys.all, staleTime: 5 * 60_000, queryFn: readClientCalendars })
}

/** The calendar to count a client's work by — Iraq's until the read lands, never a blank. */
export function useClientCalendar(clientId: string | null | undefined): { calendar: WorkingCalendar; isLoading: boolean } {
  const q = useClientCalendars()
  const calendar = (clientId ? q.data?.byClient.get(clientId) : undefined) ?? q.data?.fallback ?? IRAQ_WORKING_CALENDAR
  return { calendar, isLoading: q.isLoading }
}

/** Whichever handle a screen holds on a piece of work — the client is found from it. */
export interface WorkRef {
  clientId?: string | null
  campaignId?: string | null
  deliverableId?: string | null
  subTaskId?: string | null
}

/** The client a piece of work is for: a task's piece, a piece's job or campaign, a campaign's client.
 *  Flat, one hop per read. */
export async function readClientIdOf(ref: WorkRef): Promise<string | null> {
  if (ref.clientId) return ref.clientId
  let { campaignId, deliverableId } = ref
  if (!campaignId && !deliverableId && ref.subTaskId) {
    const { data, error } = await supabaseUntyped.from('sub_tasks').select('deliverable_id').eq('id', ref.subTaskId).maybeSingle()
    if (error) throw error
    deliverableId = (data as { deliverable_id: string } | null)?.deliverable_id ?? null
  }
  if (!campaignId && deliverableId) {
    const { data, error } = await supabaseUntyped.from('deliverables').select('stream_id, job_id').eq('id', deliverableId).maybeSingle()
    if (error) throw error
    const piece = data as { stream_id: string | null; job_id: string | null } | null
    if (piece?.job_id) {
      const job = await supabaseUntyped.from('jobs').select('client_id').eq('id', piece.job_id).maybeSingle()
      if (job.error) throw job.error
      return (job.data as { client_id: string | null } | null)?.client_id ?? null
    }
    if (piece?.stream_id) {
      const stream = await supabaseUntyped.from('streams').select('campaign_id').eq('id', piece.stream_id).maybeSingle()
      if (stream.error) throw stream.error
      campaignId = (stream.data as { campaign_id: string | null } | null)?.campaign_id ?? null
    }
  }
  if (!campaignId) return null
  const { data, error } = await supabaseUntyped.from('campaigns').select('client_id').eq('id', campaignId).maybeSingle()
  if (error) throw error
  return (data as { client_id: string | null } | null)?.client_id ?? null
}

/** The client a piece of work is for, from whatever the screen holds; null until it is known. */
export function useWorkClientId(ref: WorkRef): { clientId: string | null; isLoading: boolean } {
  const key = ref.clientId ?? ref.campaignId ?? ref.deliverableId ?? ref.subTaskId ?? null
  const client = useQuery({
    queryKey: [...clientCalendarKeys.all, 'client-of', ref.clientId ?? null, ref.campaignId ?? null, ref.deliverableId ?? null, ref.subTaskId ?? null],
    enabled: !!key && !ref.clientId,
    staleTime: 5 * 60_000,
    queryFn: () => readClientIdOf(ref),
  })
  return { clientId: ref.clientId ?? client.data ?? null, isLoading: client.isLoading && !!key && !ref.clientId }
}

/** The calendar a piece of work is counted by (ADR-0123 d.3), from whatever the screen holds. */
export function useWorkCalendar(ref: WorkRef): { calendar: WorkingCalendar; isLoading: boolean } {
  const client = useWorkClientId(ref)
  const cal = useClientCalendar(client.clientId)
  return { calendar: cal.calendar, isLoading: cal.isLoading || client.isLoading }
}
