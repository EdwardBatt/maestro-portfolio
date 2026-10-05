/**
 * The single-job flow's own vocabulary and arithmetic — pure, so every screen (SJ-02 → SJ-04) and
 * every test reads the same definitions and no screen re-derives one.
 *
 * A single job IS a campaign row (ADR-0083 d.3). What this file adds is the shape of the request
 * that campaign carries — who asked, how, and in their own words — and the rules the screens
 * enforce before the account manager may press Next or Approve.
 */

import { RISK_KEY, SINGLE_EXECUTION } from '../../../lib/brief/single-execution'

export { RISK_KEY, SINGLE_EXECUTION }

/** ADR-0084 d.6a: the one mandatory field. A template-level `required` flag does not exist yet. */
export const REQUIRED_BRIEF_KEYS: readonly string[] = ['task']

/** ADR-0083 d.5: the fixed list. `internal` is there because "who asked" may not be a client. */
export const REQUEST_SOURCES = ['whatsapp', 'email', 'phone', 'meeting', 'internal', 'other'] as const
export type RequestSource = (typeof REQUEST_SOURCES)[number]

export function isRequestSource(value: unknown): value is RequestSource {
  return typeof value === 'string' && (REQUEST_SOURCES as readonly string[]).includes(value)
}

/** What SJ-v3-01 and SJ-02 collect, as the screens hold it. */
export interface RequestDraft {
  title: string
  clientId: string
  brandId: string
  /** The kind of brief — a `brief_templates.brief_type` key, chosen on SJ-v3-01 (22 Sep). */
  briefType: string
  askedBy: string
  source: RequestSource | ''
  /** The client's own words, verbatim (ADR-0083 d.6). */
  words: string
  deliverableTypeId: string
  quantity: number
  /** `YYYY-MM-DD`, typed — there is no proposed date (ADR-0083 d.7). */
  dueDate: string
  channel: string
  format: string
  departmentId: string
  /** SJ-v3-04: High / Medium / Low, carried on the job's record. */
  priority: Priority | ''
  /** SJ-v3-S2: the due date left fewer working days than the type needs and the person went on. */
  reducedScope: boolean
  /** I54.33 (Edward, 27 Sep): the job's further deliverables, after the first. Same department, owner
   *  and due date as the job — only what each one IS differs. */
  more: DeliverableSpec[]
  /** ADR-0117 d.1 (Edward, 27 Sep): the languages the job is made in, in the order chosen. */
  languages: string[]
}

/** What one further deliverable of a single job is (I54.33). */
export interface DeliverableSpec {
  deliverableTypeId: string
  quantity: number
  channel: string
  format: string
  /** ADR-0138 d.2: a further piece may belong to another department ('' = the job's). */
  departmentId: string
  /** Its owner, one of that department's leads ('' = that department's lead; the job's owner on the job's department). */
  ownerUserId: string
  /** ADR-0138 d.3: its own due day, YYYY-MM-DD ('' = the job's). */
  dueDate: string
  /** ADR-0138 d.1: filled from the brief's suggestion and not yet changed by a person. */
  suggested?: boolean
}

export const EMPTY_SPEC: DeliverableSpec = { deliverableTypeId: '', quantity: 1, channel: '', format: '', departmentId: '', ownerUserId: '', dueDate: '' }

/**
 * ADR-0138 d.4: a single job whose pieces span departments, or fall on different days, reads like a campaign.
 * Warned, never refused. A piece with no department or date of its own shares the job's.
 */
export function readsLikeACampaign(r: Pick<RequestDraft, 'departmentId' | 'dueDate' | 'more'>): { departments: boolean; dates: boolean } {
  const depts = new Set([r.departmentId, ...r.more.map((m) => m.departmentId || r.departmentId)].filter(Boolean))
  const days = new Set([r.dueDate, ...r.more.map((m) => m.dueDate || r.dueDate)].filter(Boolean))
  return { departments: depts.size > 1, dates: days.size > 1 }
}

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

export const EMPTY_REQUEST: RequestDraft = {
  title: '',
  clientId: '',
  brandId: '',
  briefType: '',
  askedBy: '',
  source: '',
  words: '',
  deliverableTypeId: '',
  quantity: 1,
  dueDate: '',
  channel: '',
  format: '',
  departmentId: '',
  priority: '',
  reducedScope: false,
  more: [],
  languages: [],
}

/**
 * What SJ-02 refuses to leave without. Required: the title (ADR-0083 addendum), the client, the
 * client's words (d.6), the due date (d.7) and the department (d.8). The proof is optional —
 * evidence is optional on every brief (ADR-0066 d.10), and an un-evidenced job while the reply is
 * awaited is the state ADR-0083 d.4 describes.
 */
/** What SJ-v3-01 refuses to leave without: the client, the kind of brief, and the client's own
 *  words (ADR-0083 d.6 — they moved up with the rest of the evidence, 22 Sep). */
export function briefTypeMissing(r: RequestDraft): (keyof RequestDraft)[] {
  const missing: (keyof RequestDraft)[] = []
  if (!r.clientId) missing.push('clientId')
  if (!r.briefType) missing.push('briefType')
  if (!r.words.trim()) missing.push('words')
  return missing
}

export function requestMissing(r: RequestDraft): (keyof RequestDraft)[] {
  const missing: (keyof RequestDraft)[] = []
  if (!r.title.trim()) missing.push('title')
  if (!r.dueDate) missing.push('dueDate')
  if (!r.departmentId) missing.push('departmentId')
  // ADR-0117 addendum (Q19, 4 Oct): a job is made in at least one language — no default, the person picks.
  if (r.languages.length === 0) missing.push('languages')
  return missing
}

/**
 * What the single job's one deliverable is called (I52.1, Edward 17 Sep: *"why is the deliverable
 * name the same as the campaign title?"*).
 *
 * SJ-02 asks "What is needed" — the deliverable type, with a quantity — and until 17 Sep the wizard
 * saved that as the row's TYPE and named the row from the job-title box, so every task, notification
 * and email read "K two — Creative Direction — K two". The name is the thing the AM picked. The job
 * title is the fallback only when no type was chosen, because a deliverable cannot be nameless.
 *
 * The count is NOT in the name (I67.1, Edward 30 Sep): it lives in `quantity` and is printed beside
 * the name where deliverables are listed ("Static Post × 3", I53.14), as on a campaign piece. In the
 * name it reached every screen that shows a task beside its piece — "Static Post ×3 · Translation".
 */
export function deliverableNameFor(typeName: string | null, jobTitle: string): string {
  const base = (typeName ?? '').trim()
  return base || jobTitle.trim()
}

/**
 * The request as it is stored in `campaigns.brief` — the same jsonb the campaign wizard writes its
 * strategy into, holding a single job's request instead. One column, two shapes, told apart by
 * `kind` on the row (ADR-0086 d.8) and by this marker inside the document.
 */
export interface StoredRequest {
  askedBy: string
  source: RequestSource | null
  words: string
  /** The kind of brief chosen on SJ-v3-01; `null` on a job saved before 22 Sep. */
  briefType: string | null
  priority: Priority | null
  reducedScope: boolean
}

export function requestRecord(
  r: RequestDraft,
  ownerUserId: string | null = null,
  /** SJ-v3-02 (22 Sep): the brief is written BEFORE the department is chosen, so until a
   *  `campaign_briefs` row can be filed it autosaves here, inside the draft. */
  briefValues: Record<string, string> | null = null,
): Record<string, unknown> {
  return {
    kind: 'single_job',
    ...(briefValues ? { briefValues } : {}),
    // ADR-0117 d.1: `write_campaign_content` writes `campaigns.languages` from this.
    languages: r.languages,
    request: {
      askedBy: r.askedBy.trim(),
      source: r.source || null,
      words: r.words,
      briefType: r.briefType || null,
      priority: r.priority || null,
      reducedScope: r.reducedScope,
    } satisfies StoredRequest,
    // The wizard's shape, so `department_brief_approvers` and every other reader of the brief's
    // deliverable list finds the owner where it expects to. `departmentId` is this flow's own
    // addition — the department is chosen and the owner follows from it (ADR-0083 d.8), so the
    // choice is kept alongside the person it produced.
    deliverables: [
      {
        name: r.title.trim(),
        ownerUserId,
        quantity: r.quantity,
        commenceAt: null,
        dueAt: r.dueDate || null,
        deliverableTypeId: r.deliverableTypeId || null,
        channel: r.channel || null,
        format: r.format || null,
        departmentId: r.departmentId || null,
        priority: r.priority || null,
      },
      // I54.33: the further deliverables; ADR-0138: each may carry its own department, owner and date.
      ...r.more.map((m) => ({
        name: '',
        ownerUserId: m.ownerUserId || ownerUserId,
        quantity: m.quantity,
        commenceAt: null,
        dueAt: m.dueDate || r.dueDate || null,
        deliverableTypeId: m.deliverableTypeId || null,
        channel: m.channel || null,
        format: m.format || null,
        departmentId: m.departmentId || r.departmentId || null,
        priority: r.priority || null,
      })),
    ],
  }
}

/** ADR-0117 d.1: the languages a stored single-job brief carries. */
export function readStoredLanguages(brief: unknown): string[] {
  const b = (brief ?? {}) as Record<string, unknown>
  return Array.isArray(b.languages) ? (b.languages as unknown[]).filter((x): x is string => typeof x === 'string') : []
}

/** I54.33: the further deliverables a stored single-job brief carries — every entry after the first. */
export function readStoredMore(brief: unknown): DeliverableSpec[] {
  const b = (brief ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.deliverables) ? (b.deliverables as Record<string, unknown>[]) : []
  return list.slice(1).map((d) => ({
    deliverableTypeId: typeof d.deliverableTypeId === 'string' ? d.deliverableTypeId : '',
    quantity: typeof d.quantity === 'number' && d.quantity > 0 ? d.quantity : 1,
    channel: typeof d.channel === 'string' ? d.channel : '',
    format: typeof d.format === 'string' ? d.format : '',
    departmentId: typeof d.departmentId === 'string' ? d.departmentId : '',
    ownerUserId: typeof d.ownerUserId === 'string' ? d.ownerUserId : '',
    dueDate: typeof d.dueAt === 'string' ? d.dueAt.slice(0, 10) : '',
  }))
}

/** The brief values a draft holds before its `campaign_briefs` row exists (SJ-v3-02). */
export function readStoredBriefValues(brief: unknown): Record<string, string> | null {
  const b = (brief ?? {}) as Record<string, unknown>
  const v = b.briefValues
  if (!v || typeof v !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
  return out
}

/** The deliverable specification a stored single-job brief carries — what SJ-02 chose. */
export interface StoredDeliverable {
  quantity: number
  dueAt: string | null
  deliverableTypeId: string | null
  channel: string | null
  format: string | null
  departmentId: string | null
  ownerUserId: string | null
}

export function readStoredDeliverable(brief: unknown): StoredDeliverable | null {
  const b = (brief ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.deliverables) ? (b.deliverables as Record<string, unknown>[]) : []
  const d = list[0]
  if (!d) return null
  const str = (k: string) => (typeof d[k] === 'string' && d[k] !== '' ? (d[k] as string) : null)
  return {
    quantity: typeof d.quantity === 'number' && d.quantity > 0 ? d.quantity : 1,
    dueAt: str('dueAt'),
    deliverableTypeId: str('deliverableTypeId'),
    channel: str('channel'),
    format: str('format'),
    departmentId: str('departmentId'),
    ownerUserId: str('ownerUserId'),
  }
}

/** Read the request back out of a stored brief. Tolerant: an older or foreign document reads as blank. */
export function readStoredRequest(brief: unknown): StoredRequest {
  const b = (brief ?? {}) as Record<string, unknown>
  const req = (b.request ?? {}) as Record<string, unknown>
  return {
    askedBy: typeof req.askedBy === 'string' ? req.askedBy : '',
    source: isRequestSource(req.source) ? req.source : null,
    words: typeof req.words === 'string' ? req.words : '',
    briefType: typeof req.briefType === 'string' && req.briefType !== '' ? req.briefType : null,
    priority: (PRIORITIES as readonly string[]).includes(req.priority as string) ? (req.priority as Priority) : null,
    reducedScope: req.reducedScope === true,
  }
}

/** A template field, as `brief_templates.fields` holds it. */
export interface TemplateField {
  key: string
  en: string
  ar: string
  guidance: string
  /** SJ-v3-02: one of the template's essentials (section 1). Absent means the rest. */
  essential?: boolean
}

/**
 * Fill EMPTY fields only from an ingest result (ADR-0084 d.6, ADR-0044 §5). What a person typed is
 * never overwritten; what the model filled is returned so the screen can mark it as unreviewed.
 */
export function fillEmptyFields(
  current: Record<string, string>,
  proposed: Record<string, string>,
  keys: readonly string[],
): { next: Record<string, string>; filled: string[] } {
  const next = { ...current }
  const filled: string[] = []
  for (const key of keys) {
    const value = proposed[key]?.trim()
    if (!value) continue
    if ((next[key] ?? '').trim()) continue
    next[key] = value
    filled.push(key)
  }
  return { next, filled }
}

/**
 * Which field a brief of this template cannot leave without (ADR-0084 d.6a). "The Task" when the
 * template has one; otherwise its FIRST field — since 22 Sep the single job is written from any
 * of the tenant's templates (SJ-v3-01), and no template carries a `required` flag (144 fields,
 * zero). The line the ADR flagged as most likely to change, now per template.
 */
export function requiredBriefKeys(fields: readonly TemplateField[]): string[] {
  if (fields.some((f) => f.key === REQUIRED_BRIEF_KEYS[0])) return [...REQUIRED_BRIEF_KEYS]
  return fields[0] ? [fields[0].key] : []
}

/** Which required fields are still empty. Empty result means the brief may proceed. */
export function briefMissing(values: Record<string, string>, fields: readonly TemplateField[]): string[] {
  return requiredBriefKeys(fields).filter((k) => !(values[k] ?? '').trim())
}

/**
 * SJ-v3-02 shows a template in two sections — "1 · The essentials" and "2 · The rest". Which is
 * which is the TEMPLATE's to say (`essential: true` on the field, ticked in Admin → Brief
 * templates; seeded per the Figma, 20260922150000). A template with nothing ticked — one made
 * before the flag existed, or a tenant's own — falls back to its first four fields, the order the
 * seeded templates were authored in.
 */
export const ESSENTIALS_COUNT = 4

export function splitBriefFields(fields: readonly TemplateField[]): { essentials: TemplateField[]; rest: TemplateField[] } {
  if (fields.some((f) => f.essential)) {
    return { essentials: fields.filter((f) => f.essential), rest: fields.filter((f) => !f.essential) }
  }
  return { essentials: fields.slice(0, ESSENTIALS_COUNT), rest: fields.slice(ESSENTIALS_COUNT) }
}

/** How many of these fields hold something. */
export function filledCount(values: Record<string, string>, fields: readonly TemplateField[]): number {
  return fields.filter((f) => (values[f.key] ?? '').trim()).length
}

/**
 * The response clock: how long the client has been waiting, from the confirmed arrival (ADR-0085
 * d.5). Displayed, never stored — the receipts are the record (ADR-0066).
 */
export interface Elapsed {
  days: number
  hours: number
  minutes: number
  totalMinutes: number
  /** The arrival is later than `now` — the clock has not begun counting up yet. */
  future: boolean
}

export function elapsedSince(startIso: string, now: number | Date = Date.now()): Elapsed | null {
  const start = Date.parse(startIso)
  if (Number.isNaN(start)) return null
  const at = typeof now === 'number' ? now : now.getTime()
  const raw = Math.floor((at - start) / 60_000)
  const future = raw < 0
  const totalMinutes = Math.max(0, raw)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60)
  const minutes = totalMinutes - days * 24 * 60 - hours * 60
  return { days, hours, minutes, totalMinutes, future }
}

/** `92% name match` needs a whole percent; the RPC returns a 0–1 similarity. */
export function matchPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}
