import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'

/**
 * The brief receipt — evidence that a brief was issued, and when (ADR-0066).
 *
 * Three separate things, deliberately not one:
 *
 *   useReadBriefReceipt()   image in → what the screenshot SAYS out. Writes nothing.
 *   useSaveBriefReceipt()   the row, with the values a person confirmed.
 *   useBriefReceipt()       reads one back.
 *
 * THE DISTINCTION THAT MATTERS is between `receivedAt` and `capturedAt`. `receivedAt` is the
 * timestamp INSIDE the image and is the clock's origin; `capturedAt` is when the screenshot
 * reached us and is stamped by the database, never sent from here. A brief received Tuesday 14:32
 * and screenshotted Wednesday 09:00 is already eighteen and a half hours old, and anchoring on
 * the upload would forgive exactly the delay this measures (d.5).
 *
 * The model PROPOSES and a person CONFIRMS (d.4). An unconfirmed row starts no clock at all.
 */

export const receiptKeys = {
  all: ['brief-receipt'] as const,
  forCampaign: (campaignId: string) => [...receiptKeys.all, campaignId] as const,
  zones: () => [...receiptKeys.all, 'zones'] as const,
}

/** What the screenshot says. Empty strings mean the image did not say — never "not read". */
export interface ReceiptReading {
  subject: string
  /** `YYYY-MM-DD`, or empty when the image showed no absolute date (d.13). */
  receivedDate: string
  /** 24-hour `HH:MM`, or empty. */
  receivedTime: string
  /** True when a person still has to complete it. */
  partial: boolean
}

/**
 * Re-validated on arrival. The Edge Function already validated the model's answer against this
 * shape; doing it again costs nothing and means a compromised or simply out-of-date function
 * still cannot put an unexpected value into the form.
 */
const readingSchema = z.object({
  subject: z.string().catch(''),
  receivedDate: z.string().catch(''),
  receivedTime: z.string().catch(''),
  partial: z.boolean().catch(true),
})

/** A refusal the SERVER made, as opposed to a service that fell over — the same split as ADR-0044. */
export class ReceiptReadRefusedError extends Error {
  readonly code: 'unauthenticated' | 'forbidden' | 'too_large' | 'unconfigured' | 'mismatch'
  constructor(code: ReceiptReadRefusedError['code']) {
    super(code)
    this.name = 'ReceiptReadRefusedError'
    this.code = code
  }
}

const REFUSAL_BY_STATUS: Record<number, ReceiptReadRefusedError['code']> = {
  400: 'mismatch',
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'too_large',
  503: 'unconfigured',
}

function refusalFor(error: unknown): ReceiptReadRefusedError | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  if (typeof status !== 'number') return null
  const code = REFUSAL_BY_STATUS[status]
  return code ? new ReceiptReadRefusedError(code) : null
}

/**
 * Read a screenshot. Returns what it says; never writes.
 *
 * There is no fallback path here and there deliberately is not one: where `ingest-brief` can fall
 * back to heading matching, the fallback for a screenshot is a person typing three fields, which
 * is a supported way to record a receipt (d.10) rather than a degraded one. So a failure is
 * reported honestly and the fields stay empty and editable.
 */
export function useReadBriefReceipt() {
  return useMutation<ReceiptReading, Error, { image: string }>({
    mutationFn: async ({ image }) => {
      try {
        const res = await supabaseUntyped.functions.invoke('read-brief-receipt', { body: { image } })
        if (res.error) throw res.error
        const parsed = readingSchema.safeParse(res.data)
        if (!parsed.success) throw new Error('unexpected_receipt_response')
        return parsed.data
      } catch (e) {
        const refusal = refusalFor(e)
        if (refusal || e instanceof ReceiptReadRefusedError) throw refusal ?? e
        throw e
      }
    },
  })
}

export interface BriefReceipt {
  id: string
  campaignId: string
  assetId: string | null
  subject: string | null
  /** The moment inside the image. Null while a person is still completing it (d.13). */
  receivedAt: string | null
  receivedTz: string | null
  /** When the screenshot reached the server. Stamped there; never the clock's origin (d.5). */
  capturedAt: string
  source: 'model' | 'manual'
  confirmedBy: string | null
  confirmedAt: string | null
}

interface ReceiptRow {
  id: string
  campaign_id: string
  asset_id: string | null
  subject: string | null
  received_at: string | null
  received_tz: string | null
  captured_at: string
  source: 'model' | 'manual'
  confirmed_by: string | null
  confirmed_at: string | null
}

const RECEIPT_COLUMNS =
  'id, campaign_id, asset_id, subject, received_at, received_tz, captured_at, source, confirmed_by, confirmed_at'

function toReceipt(r: ReceiptRow): BriefReceipt {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    assetId: r.asset_id,
    subject: r.subject,
    receivedAt: r.received_at,
    receivedTz: r.received_tz,
    capturedAt: r.captured_at,
    source: r.source,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
  }
}

/**
 * The campaign's receipt — its FIRST one. A campaign carries a trail since ADR-0086 d.5 (a job
 * attached to it brings its own receipt), and the clock reads the earliest confirmed row, so that
 * is the one this shows and edits. Ordered by arrival with unknown arrivals last, then by when the
 * row was made: for a campaign with one receipt (every one the wizard makes) it is simply that row.
 */
export function useBriefReceipt(campaignId: string | null) {
  return useQuery({
    queryKey: receiptKeys.forCampaign(campaignId ?? 'none'),
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<BriefReceipt | null> => {
      const { data, error } = await supabaseUntyped
        .from('campaign_brief_receipts')
        .select(RECEIPT_COLUMNS)
        .eq('campaign_id', campaignId!)
        .order('received_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ? toReceipt(data as ReceiptRow) : null
    },
  })
}

export interface SaveReceipt {
  /**
   * The row being corrected, when the caller knows it. A campaign may hold several receipts
   * (ADR-0086 d.5 — attach puts the draft's beside the target's), so "the receipt for this
   * campaign" is ambiguous after an attach; the intake wizard names the row it created. Absent,
   * the earliest confirmed receipt is the one edited — the row the clock reads (ADR-0066 d.4).
   */
  id?: string | null
  campaignId: string
  assetId: string | null
  subject: string
  /** `YYYY-MM-DD` as confirmed by a person, or empty while still partial. */
  receivedDate: string
  /** `HH:MM` as confirmed by a person, or empty. */
  receivedTime: string
  /** IANA zone the two above are read in (d.14). */
  timeZone: string
  source: 'model' | 'manual'
  /** False while a field is still missing — the row is saved, the clock does not start. */
  confirmed: boolean
}

/**
 * Build the instant `receivedDate` + `receivedTime` name in `timeZone`.
 *
 * A screenshot shows a wall-clock reading with no offset (d.14): the sender's mail client
 * rendered it in the READER's zone and the image cannot say which. So a zone is chosen — the
 * confirming person's office — and the two halves are resolved against it here rather than being
 * handed to `new Date()`, which would silently apply the BROWSER's zone and put the receipt hours
 * out for anyone travelling or working from another office.
 *
 * Exported for its own tests: this is the one piece of arithmetic in the feature.
 */
export function instantFrom(date: string, time: string, timeZone: string): string | null {
  if (!date || !time) return null
  // Start from the wall-clock reading as if it were UTC, then correct by the zone's offset at
  // that moment. Two passes, because the offset itself depends on the date (a DST boundary moves
  // it) and the first guess is what tells us which side of the boundary we are on.
  const naive = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(naive)) return null
  let instant = naive
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMs(instant, timeZone)
    if (offset === null) return null
    instant = naive - offset
  }
  return new Date(instant).toISOString()
}

/**
 * The inverse of `instantFrom`: the wall-clock reading a person confirmed, back out of the stored
 * instant (I40).
 *
 * **Not a string split.** `received_at` is a `timestamptz`, so its ISO form is UTC — splitting on
 * `T` returns UTC wall-clock, and a brief received at 14:32 in Baghdad would read back as 11:32.
 * The reading a person confirmed is the one inside the image (ADR-0066 d.5); it must survive a
 * round trip through the database unchanged, or a receipt starts disagreeing with its own evidence.
 *
 * Returns empty strings for anything missing or unparseable — the form treats those the same as
 * never having been filled, which is what they are.
 */
export function wallClockIn(instantIso: string | null, timeZone: string | null): {
  date: string
  time: string
} {
  const blank = { date: '', time: '' }
  if (!instantIso || !timeZone) return blank
  const ms = Date.parse(instantIso)
  if (Number.isNaN(ms)) return blank
  const offset = zoneOffsetMs(ms, timeZone)
  if (offset === null) return blank
  // Shift the instant by the zone's offset and read it AS IF UTC — the mirror of how
  // `instantFrom` starts from the wall clock and corrects by the same offset.
  const shifted = new Date(ms + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  }
}

/** How far `timeZone` is from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    )
    return asUtc - instant
  } catch {
    // An unknown zone name. Refusing beats silently recording the browser's zone as fact.
    return null
  }
}

/**
 * Write the receipt. The wizard makes one per campaign; it used to upsert on `campaign_id`, which
 * stopped being unique when ADR-0086 d.5 let an attached job bring its receipt along. So: the
 * campaign's first receipt (the same row `useBriefReceipt` shows) is updated by id when it exists,
 * and inserted otherwise. Same outcome for every campaign the wizard has ever made.
 *
 * `capturedAt` and `confirmedBy` are NOT sent: the database stamps both, and that is the point —
 * they are the columns an argument about a late brief would turn on, so they are things that are
 * true rather than things a client intended (see the migration's header).
 */
export function useSaveBriefReceipt() {
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async (input: SaveReceipt): Promise<void> => {
      const receivedAt = instantFrom(input.receivedDate, input.receivedTime, input.timeZone)
      // The CHECK refuses a confirmed row with no timestamp, and it is right to: a confirmed
      // receipt with no origin is a clock with no start. Caught here so it reads as a sentence.
      const confirmed = input.confirmed && receivedAt !== null
      const row = {
        tenant_id: claims.tenantId,
        campaign_id: input.campaignId,
        asset_id: input.assetId,
        subject: input.subject.trim() || null,
        received_at: receivedAt,
        received_tz: receivedAt ? input.timeZone : null,
        source: input.source,
        // Any non-null value confirms; the trigger overwrites it with the server's clock and
        // stamps who from auth.uid(). Sending `now()` from the browser would be a value the
        // browser chose, which is exactly what the trigger exists to prevent.
        confirmed_at: confirmed ? new Date().toISOString() : null,
      }
      let existingId = input.id ?? null
      if (!existingId) {
        const existing = await supabaseUntyped
          .from('campaign_brief_receipts')
          .select('id')
          .eq('campaign_id', input.campaignId)
          .order('received_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (existing.error) throw existing.error
        existingId = (existing.data as { id: string } | null)?.id ?? null
      }
      const { error } = existingId
        ? await supabaseUntyped.from('campaign_brief_receipts').update(row).eq('id', existingId)
        : await supabaseUntyped.from('campaign_brief_receipts').insert(row)
      if (error) throw error
    },
    onSuccess: (_r, v) =>
      void qc.invalidateQueries({ queryKey: receiptKeys.forCampaign(v.campaignId) }),
  })
}

export interface ReceiptTimeZones {
  /** The confirming person's own office zone — the default (d.14). */
  mine: string
  /** Every zone the tenant actually operates in, so a correction is a pick and not typing. */
  options: string[]
}

/** The browser's zone. Only a fallback, and a poor one: it follows the laptop, not the office. */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Which zone a screenshot's wall-clock reading should be read in (ADR-0066 d.14).
 *
 * A screenshot carries no offset, so one has to be CHOSEN rather than assumed. The confirming
 * person's office is the closest available truth and is right in the ordinary case — but a person
 * travelling, or covering for another office, would otherwise record a receipt several hours out
 * with nothing on screen saying so. Hence `options`: the zone is shown and can be corrected.
 *
 * `office_id` is nullable and legitimately null for plenty of people, so the browser's zone is the
 * fallback. It is the worst of the three answers (it follows the laptop) and is why the zone is
 * displayed rather than applied silently.
 */
export function useReceiptTimeZones() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  return useQuery({
    queryKey: receiptKeys.zones(),
    queryFn: async (): Promise<ReceiptTimeZones> => {
      const [mineRes, allRes] = await Promise.all([
        userId
          ? supabaseUntyped
              .from('user_profiles')
              .select('offices(timezone)')
              .eq('id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseUntyped.from('offices').select('timezone').order('timezone'),
      ])
      if (mineRes.error) throw mineRes.error
      if (allRes.error) throw allRes.error

      // PostgREST returns an embedded to-one as an object or a single-element array depending on
      // how it resolved the relationship; both shapes are handled rather than guessed at.
      const embed = (mineRes.data as { offices: { timezone: string } | { timezone: string }[] | null } | null)?.offices
      const office = Array.isArray(embed) ? embed[0] ?? null : embed
      const mine = office?.timezone || browserZone()

      const zones = ((allRes.data ?? []) as { timezone: string }[]).map((o) => o.timezone)
      const options = Array.from(new Set([mine, ...zones])).filter(Boolean).sort()
      return { mine, options }
    },
  })
}
