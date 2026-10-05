import { usePeopleNames } from '../dashboard/api/dashboard-data'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { BusyDialog, NoticeDialog } from '../../components/Notice'
import { NoticeBox } from '../../components/NoticeBox'
import { StepRail } from '../../components/StepRail'
import { useCampaignFolderRoot } from '../../lib/assets/folders'
import { endOfWorkingDay, iraqDay } from '../../lib/time/iraq'
import { useDepartments } from '../admin/api/admin-api'
import { useBriefTemplates } from '../admin/api/brief-templates-api'
import { useAddLanguage, useAttributeValues, useDeliverableCategories, useDeliverableTypes } from '../admin/api/deliverable-types-api'
import { useUpdateCampaignDraft, useWizardRefData } from '../campaigns/api/campaign-api'
import { useReminderSettings } from '../../lib/settings/reminder-settings-api'
import { useApproveCampaign } from '../campaigns/api/campaign-detail-api'
import { fetchCampaignReferencesFolder, receiptFile, useFileDocuments } from '../campaigns/api/document-filing-api'
import {
  instantFrom,
  useBriefReceipt,
  useSaveBriefReceipt,
  wallClockIn,
  type SaveReceipt,
} from '../campaigns/api/brief-receipt-api'
import { EMPTY_RECEIPT, type ReceiptDraft } from '../campaigns/components/BriefReceiptPanel'
import { fetchAssetDownloadUrl } from '../library/api/library-api'
import {
  isNotDraft,
  useAttachJobToCampaign,
  useCompleteSingleJobDraft,
  useDepartmentLeads,
  useTeamLeads,
  useClientBriefUsage,
  useClientRules,
  useIngestSingleExecution,
  useSaveSingleExecutionBrief,
  useSimilarOpenJobs,
  useSingleExecutionBrief,
  useSingleExecutionTemplate,
  useSingleJob,
  useStartSingleJobDraft,
  type SimilarJob,
  type SingleExecutionIngestResult,
} from './api/intake-api'
import {
  EMPTY_REQUEST,
  RISK_KEY,
  EMPTY_SPEC,
  SINGLE_EXECUTION,
  briefMissing,
  briefTypeMissing,
  deliverableNameFor,
  fillEmptyFields,
  readStoredBriefValues,
  readStoredDeliverable,
  readStoredMore,
  readStoredLanguages,
  readStoredRequest,
  requestMissing,
  requestRecord,
  type DeliverableSpec,
  type RequestDraft,
  type TemplateField,
} from './lib/single-job'
import { BriefTypeStep } from './components/BriefTypeStep'
import { WhoAndWhenStep } from './components/WhoAndWhenStep'
import { ShortDateDialog } from './components/ShortDateDialog'
import { briefTypeLook } from './components/brief-type-icons'
import { computeLeadTime } from './lib/lead-time'
import { useClientCalendar } from '../../lib/calendar/client-calendar'
import { RULES_KEY, serializeRules } from '../../lib/brief/rules'
import { useFillerWordList } from '../../lib/brief/filler-words-api'
import { fillerRefusalMessage } from '../../lib/brief/filler-refusal'
import { BriefStep } from './components/BriefStep'
import { formatCalendarDay } from '../../lib/time/iraq'
import { useGenerateDeliverables } from '../../lib/brief/generate-deliverables'
import { JobReviewStep } from './components/JobReviewStep'
import { SimilarJobsDialog } from './components/SimilarJobsDialog'

/**
 * The single-job flow behind the one door (ADR-0082 d.5): SJ-v3-01 the kind of brief (Figma
 * `B · SINGLE JOB — BRIEF FIRST`, 22 Sep), SJ-02 the request (ADR-0083), SJ-03 the brief
 * (ADR-0084), SJ-04 review and approve (ADR-0085), with SJ-A1 over the last (ADR-0086).
 *
 * **The v3 reformat is being applied one screen at a time** (Edward, 22 Sep), in the Figma's
 * ORDER: 1 Type of brief (with the evidence), 2 The brief, 3 Who and when, 4 Review. Screens 1
 * and 2 are in their v3 shape; 3 is still the earlier request screen until its turn.
 *
 * **The job is created on Next from screen 1** (a provisional name — the title is typed on 3),
 * so the receipt has a campaign to file into and the brief has a References folder. The brief is
 * written before the department is known, so it autosaves INTO THE DRAFT (`campaigns.brief
 * .briefValues`) and becomes a `campaign_briefs` row on Next from 3, once there is a department
 * to file it under.
 *
 * **A single job is a campaign row** (ADR-0083 d.3), so this is mostly assembly: the wizard's
 * reference data, the receipt path, the filing path, the approval RPC and the campaign page are
 * all reused, not rebuilt. What is new is the shape of the request and the order of the screens.
 *
 * **The job is created on Next from SJ-02 as a DRAFT** (ADR-0085 d.8, on ADR-0067's path) — the
 * receipt needs a campaign to file into. Back-and-Next corrects the draft in place; Cancel leaves
 * it under Drafts on the campaigns list, and says so. Approve on SJ-04 is what completes it —
 * stream, deliverable, held task list — and then approves it; nothing else changes its status.
 *
 * Steps are numbered by their screen names so a reader of the ADRs finds them: 2, 3, 4.
 */

type Step = 1 | 2 | 3 | 4


/** The locale label for each field SJ-02 can refuse to leave without, so the error can name them
 *  (B1). Keys match `requestMissing`. */
const REQUIRED_REQUEST_LABELS: Partial<Record<keyof RequestDraft, string>> = {
  title: 'intake.request.title',
  clientId: 'intake.request.client',
  briefType: 'intake.briefType.kindOfBrief',
  words: 'intake.request.words',
  dueDate: 'intake.request.due',
  departmentId: 'intake.request.department',
  languages: 'languages.title',
}

export function SingleJobWizard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const [searchParams] = useSearchParams()
  const resumeId = searchParams.get('job')

  const ref = useWizardRefData()
  const departments = useDepartments()
  const leads = useDepartmentLeads()
  const teamLeads = useTeamLeads()
  const types = useDeliverableTypes()
  const categories = useDeliverableCategories()
  const attributeValues = useAttributeValues()
  const addLanguage = useAddLanguage()
  const template = useSingleExecutionTemplate()
  const templates = useBriefTemplates()

  const startDraft = useStartSingleJobDraft()
  const updateDraft = useUpdateCampaignDraft()
  const complete = useCompleteSingleJobDraft()
  const saveBrief = useSaveSingleExecutionBrief()
  const fileDocuments = useFileDocuments()
  const saveReceipt = useSaveBriefReceipt()
  const similar = useSimilarOpenJobs()
  const attach = useAttachJobToCampaign()
  const approve = useApproveCampaign()

  const [step, setStep] = useState<Step>(1)
  // ADR-0092 d.3: report-to-admin is for SYSTEM errors only — never validation or permission
  // messages the user can act on. The error carries whether it is reportable.
  // I48.39: a SYSTEM error keeps whatever was thrown, so the report the administrator receives
  // carries the code, the server's message and its detail — not the friendly sentence alone.
  const [error, setError] = useState<{ message: string; reportable: boolean; cause?: unknown } | null>(null)
  const failValidation = (message: string) => setError({ message, reportable: false })
  const failSystem = (message: string, cause?: unknown) => setError({ message, reportable: true, cause })
  /** I48.41 (ADR-0092 d.1): Next waits while the request and its evidence are written. */
  const [savingRequest, setSavingRequest] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  /** True once `complete_campaign_draft` has run — a retry after a failed approval skips it. */
  const [completed, setCompleted] = useState(false)

  // CV-02's "+ New job for Kite" (ADR-0123): the client comes chosen. A resumed job brings its own.
  const [request, setRequest] = useState<RequestDraft>(() =>
    !resumeId && searchParams.get('client') ? { ...EMPTY_REQUEST, clientId: searchParams.get('client')! } : EMPTY_REQUEST)
  const [missing, setMissing] = useState<(keyof RequestDraft)[]>([])
  /** True while the draft carries a provisional name — the title has not been typed yet. */
  const provisional = useRef(false)
  const briefUsage = useClientBriefUsage(request.clientId || null)
  const reminderSettings = useReminderSettings()
  // SJ-v3: the dos and don'ts the job inherits — the client profile's, nothing else (Edward, 22
  // Sep). Snapshotted into the brief values so the department reads what the account manager saw.
  const clientRules = useClientRules(request.clientId || null)
  const rules = useMemo(() => clientRules.data ?? [], [clientRules.data])
  const [receipt, setReceipt] = useState<ReceiptDraft>(EMPTY_RECEIPT)

  const [values, setValues] = useState<Record<string, string>>({})
  const [risk, setRisk] = useState('')
  const [unreviewed, setUnreviewed] = useState<string[]>([])
  const [ingestStatus, setIngestStatus] = useState<{ text: string; warning: boolean } | null>(null)
  /** The duplicate check could not run; the release went ahead and the person is told so. A ref,
   *  because it is read inside the release that follows in the same tick. */
  const similarSkipped = useRef(false)
  const [similarSkippedNotice, setSimilarSkippedNotice] = useState<string | null>(null)
  const [briefMissingKeys, setBriefMissingKeys] = useState<string[]>([])
  /** SJ-v3-02 says "Autosaved": a debounced write of the brief while it is being typed. */
  const [saveState, setSaveState] = useState<'saving' | 'saved' | null>(null)
  const briefDirty = useRef(false)

  const [similarJobs, setSimilarJobs] = useState<SimilarJob[] | null>(null)
  /** SJ-v3-S2: the due date leaves fewer working days than the type needs; shown once, on Next. */
  const [shortDate, setShortDate] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [reviewBlocked, setReviewBlocked] = useState(false)

  // SJ-v3-02 (22 Sep): the brief is written from the template chosen on SJ-v3-01. A job saved
  // before that day, or a resumed one, has no choice recorded and falls back to single_execution.
  const briefType = request.briefType || SINGLE_EXECUTION
  const chosenTemplateRow = (templates.data ?? []).find((x) => x.briefType === briefType) ?? null
  const fields = useMemo<TemplateField[]>(
    () => (chosenTemplateRow ? chosenTemplateRow.fields : template.data ?? []),
    [chosenTemplateRow, template.data],
  )
  const fieldKeys = useMemo(() => fields.map((f) => f.key), [fields])
  const ingest = useIngestSingleExecution(fieldKeys, briefType)
  // Only a field ON THIS TEMPLATE can be waiting for Keep. A document read against one template,
  // then Back to screen 1 and a different template picked, left keys in `unreviewed` that no field
  // rendered a marker for — Next refused with nothing on screen to press (Edward, 22 Sep).
  const pendingKeep = useMemo(() => unreviewed.filter((k) => fieldKeys.includes(k)), [unreviewed, fieldKeys])

  // ---- Resuming a job left unreleased (ADR-0085 d.8) ----
  const resuming = useSingleJob(resumeId)
  // I66.12 (Edward, 29 Sep): a job already SENT for approval is not a draft any more — the database refuses
  // every draft save on it (`campaign_not_draft`). Reopened, it stays on its review step, says who it waits
  // for, and offers only Open (the approval) — never a step that would save.
  const [sentAlready, setSentAlready] = useState(false)
  const sent = sentAlready || resuming.data?.status === 'pending_approval'
  const peopleNames = usePeopleNames()
  const savedBrief = useSingleExecutionBrief(jobId)
  const savedReceipt = useBriefReceipt(jobId)

  useEffect(() => {
    if (jobId || !resuming.data) return
    const j = resuming.data
    const stored = readStoredRequest(j.brief)
    const spec = readStoredDeliverable(j.brief)
    setJobId(j.id)
    // The owner chosen before the job was left, if one was stored.
    setOwnerPick(spec?.ownerUserId ?? '')
    // Past `draft` means the release's first half ran; only the approval is still owed.
    setCompleted(j.status !== 'draft')
    const draftValues = readStoredBriefValues(j.brief)
    if (draftValues) {
      const { [RISK_KEY]: storedRisk, [RULES_KEY]: _storedRules, ...rest } = draftValues
      setValues(rest)
      setRisk(storedRisk ?? '')
    }
    setRequest({
      title: j.name,
      clientId: j.clientId,
      brandId: j.brandId ?? '',
      briefType: stored.briefType ?? '',
      askedBy: stored.askedBy,
      source: stored.source ?? '',
      words: stored.words,
      deliverableTypeId: spec?.deliverableTypeId ?? '',
      quantity: spec?.quantity ?? 1,
      // Saved as the typed `YYYY-MM-DD`; anything longer is a moment, read back as the Iraq day.
      dueDate: spec?.dueAt ? (spec.dueAt.length === 10 ? spec.dueAt : iraqDay(spec.dueAt)) : '',
      channel: spec?.channel ?? '',
      format: spec?.format ?? '',
      departmentId: spec?.departmentId ?? '',
      priority: stored.priority ?? '',
      reducedScope: stored.reducedScope,
      more: readStoredMore(j.brief),
      languages: readStoredLanguages(j.brief),
    })
  }, [jobId, resuming.data])

  const hydratedBrief = useRef<string | null>(null)
  useEffect(() => {
    const b = savedBrief.data
    if (!b || hydratedBrief.current === b.id) return
    hydratedBrief.current = b.id
    const { [RISK_KEY]: storedRisk, [RULES_KEY]: _storedRules, ...rest } = b.values
    setValues(rest)
    setRisk(storedRisk ?? '')
    if (b.briefType) setRequest((r) => (r.briefType ? r : { ...r, briefType: b.briefType }))
    // A resumed job with a brief written opens on review; one without opens on the brief.
    if (resumeId) setStep(4)
  }, [savedBrief.data, resumeId])

  useEffect(() => {
    if (sent) setStep(4)
  }, [sent])

  useEffect(() => {
    // No brief row yet: a resumed draft opens on the brief (step 2), the Figma's order.
    if (resumeId && resuming.data && resuming.data.status === 'draft' && savedBrief.isSuccess && !savedBrief.data) setStep(2)
  }, [resumeId, resuming.data, savedBrief.isSuccess, savedBrief.data])

  // ---- The receipt already recorded, read back (as the campaign wizard does since I40) ----
  const hydratedReceipt = useRef<string | null>(null)
  useEffect(() => {
    const saved = savedReceipt.data
    if (!saved || hydratedReceipt.current === saved.id) return
    hydratedReceipt.current = saved.id
    const { date, time } = wallClockIn(saved.receivedAt, saved.receivedTz)
    setReceipt((cur) => ({
      ...cur,
      subject: cur.subject || (saved.subject ?? ''),
      receivedDate: cur.receivedDate || date,
      receivedTime: cur.receivedTime || time,
      timeZone: cur.timeZone || (saved.receivedTz ?? ''),
      source: saved.source,
      confirmed: cur.confirmed || Boolean(saved.confirmedAt),
    }))
  }, [savedReceipt.data])

  const [filedUrl, setFiledUrl] = useState<string | null>(null)
  useEffect(() => {
    const assetId = savedReceipt.data?.assetId
    if (!assetId) { setFiledUrl(null); return }
    let live = true
    void fetchAssetDownloadUrl(assetId)
      .then((url) => { if (live) setFiledUrl(url) })
      .catch(() => { if (live) setFiledUrl(null) })
    return () => { live = false }
  }, [savedReceipt.data?.assetId])

  /** Same screenshot as last time through → not re-uploaded (compared by File identity). */
  const filedScreenshot = useRef<{ image: File; assetId: string | null } | null>(null)

  // ---- Derived ----
  const clients = ref.data?.clients ?? []
  const brands = ref.data?.brands ?? []
  const departmentList = departments.data ?? []
  const leadList = leads.data ?? []
  const activeTypes = useMemo(() => {
    const cats = new Map((categories.data ?? []).map((c) => [c.code, c]))
    return (types.data ?? [])
      .filter((x) => x.isActive)
      .map((x) => ({ ...x, categoryName: cats.get(x.categoryCode)?.nameEn, categoryNameAr: cats.get(x.categoryCode)?.nameAr ?? null, categoryOrder: cats.get(x.categoryCode)?.sortOrder }))
  }, [types.data, categories.data])
  const valuesFor = (attr: string) => (attributeValues.data ?? []).filter((v) => v.attribute === attr && v.isActive)

  const clientName = clients.find((c) => c.id === request.clientId)?.name ?? ''
  const chosenTemplate = (templates.data ?? []).find((x) => x.briefType === request.briefType) ?? null
  const chosenTemplateName = chosenTemplate ? ((i18n.language === 'ar' && chosenTemplate.nameAr) || chosenTemplate.nameEn) : null
  const brandName = brands.find((b) => b.id === request.brandId)?.name ?? null
  const typeName = activeTypes.find((x) => x.id === request.deliverableTypeId)?.nameEn ?? null
  const departmentName = departmentList.find((d) => d.id === request.departmentId)?.name ?? ''
  const lead = leadList.find((l) => l.departmentId === request.departmentId) ?? null
  // Edward, 27 Sep (ADR-0083 addendum): the owner is chosen from the department's lead and all its
  // team leads; the department lead until somebody picks another. With no department lead a team
  // lead must be picked (d.12). `ownerPick` is the choice — cleared when the department changes (on
  // the pill itself, so a resumed job's stored pick survives), and only honoured while it is one of
  // this department's leads.
  const deptTeamLeads = (teamLeads.data ?? []).filter((l) => l.departmentId === request.departmentId)
  const [ownerPick, setOwnerPick] = useState('')
  const picked = [...leadList.filter((l) => l.departmentId === request.departmentId), ...deptTeamLeads]
    .find((l) => l.id === ownerPick) ?? null
  const ownerId = picked?.id ?? lead?.id ?? null
  const ownerName = picked?.name ?? lead?.name ?? null
  const accountManagerId = clients.find((c) => c.id === request.clientId)?.accountManagerId ?? null

  /** The confirmed arrival as an instant — the clock's origin (ADR-0066 d.5). */
  const clockStart = useMemo(() => {
    if (receipt.confirmed && receipt.receivedDate && receipt.receivedTime && receipt.timeZone) {
      return instantFrom(receipt.receivedDate, receipt.receivedTime, receipt.timeZone)
    }
    return savedReceipt.data?.confirmedAt ? savedReceipt.data.receivedAt : null
  }, [receipt, savedReceipt.data])

  // Attachments file into the job's own References folder (ADR-0084 d.7).
  const jobFolderRoot = useCampaignFolderRoot(jobId ?? null).data ?? null
  const [referencesFolderId, setReferencesFolderId] = useState<string | null>(null)
  useEffect(() => {
    if (!jobId) { setReferencesFolderId(null); return }
    let live = true
    void fetchCampaignReferencesFolder(jobId).then((id) => { if (live) setReferencesFolderId(id ?? null) }).catch(() => { if (live) setReferencesFolderId(null) })
    return () => { live = false }
  }, [jobId, jobFolderRoot?.id])

  // SJ-v3-04: what the chosen type needs, counted back from the due date (S2 when short). With more
  // than one deliverable (I54.33) the one that needs longest sets the start: they share the date.
  const typeOf = (id: string) => activeTypes.find((x) => x.id === id) ?? null
  const neededHours = [request.deliverableTypeId, ...request.more.map((m) => m.deliverableTypeId)]
    .map((id) => typeOf(id)?.leadTimeHours ?? null)
    .filter((h): h is number => h != null)
  const leadTimeHours = neededHours.length ? Math.max(...neededHours) : null
  // ADR-0123 d.3: the chosen client's working week.
  const { calendar: clientCalendar } = useClientCalendar(request.clientId || null)
  const leadTime = useMemo(
    () => computeLeadTime(request.dueDate, leadTimeHours, undefined, clientCalendar),
    [request.dueDate, leadTimeHours, clientCalendar],
  )
  // SJ-v3: from screen 2 on, the flow wears the chosen template's hue (the card's colour).
  const flowHue = step > 1 && chosenTemplateRow ? briefTypeLook(chosenTemplateRow.briefType, 0).hue : null

  // ---- SJ-02 → SJ-03: create or correct the job, file the receipt ----
  // I54.33: the first deliverable, then each further one on the same owner, date and priority.
  const deliverablesPayload = () => [
    deliverablePayload(),
    ...request.more.map((m) => ({
      ...deliverablePayload(),
      // ADR-0138 d.2–3: a piece on another department is owned there (its lead unless another was
      // picked); a piece with its own day is due then. Neither is given: the job's.
      ownerUserId: m.ownerUserId || (m.departmentId ? leadList.find((l) => l.departmentId === m.departmentId)?.id ?? null : null) || ownerId,
      dueAt: (m.dueDate || request.dueDate) ? endOfWorkingDay(m.dueDate || request.dueDate).toISOString() : null,
      name: deliverableNameFor(typeOf(m.deliverableTypeId)?.nameEn ?? null, request.title),
      deliverableTypeId: m.deliverableTypeId || null,
      quantity: m.quantity,
      channel: m.channel || null,
      format: m.format || null,
    })),
  ]
  const deliverablePayload = () => ({
    // I52.1: named after what was picked under "What is needed", not after the job.
    name: deliverableNameFor(typeName, request.title),
    ownerUserId: ownerId,
    // A due DAY becomes the close of that working day in Iraq (ADR-0076 d.3), the way
    // /deliverables writes one — a bare YYYY-MM-DD would land at midnight UTC (review, 11 Sep).
    dueAt: request.dueDate ? endOfWorkingDay(request.dueDate).toISOString() : null,
    deliverableTypeId: request.deliverableTypeId || null,
    quantity: request.quantity,
    channel: request.channel || null,
    format: request.format || null,
    priority: request.priority || null,
  })

  // ---- ADR-0138 d.1: the brief suggests what the job makes, on arriving at who and when ----
  const generate = useGenerateDeliverables()
  const suggestedOnce = useRef(false)
  const [suggestion, setSuggestion] = useState<'asking' | 'suggested' | 'none' | 'failed' | null>(null)
  async function suggestDeliverables() {
    // Once per job, and only onto an empty choice: a person's pick is never replaced.
    if (suggestedOnce.current || request.deliverableTypeId || request.more.length > 0) return
    suggestedOnce.current = true
    const words = [`Job: ${request.title || provisionalTitle()}`]
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim()
      if (v) words.push(`${f.en}: ${v}`)
    }
    setSuggestion('asking')
    try {
      const proposal = await generate.mutateAsync({ brief: words.join('\n\n') })
      const idForCode = (code: string | null) => (code && activeTypes.find((x) => x.code === code)?.id) || ''
      const channelFor = (c: string | null) => (c && valuesFor('channel').some((v) => v.code === c) ? c : '')
      const rows = proposal.rows
      if (rows.length === 0) { setSuggestion('none'); return }
      const deptOf = (i: number) => {
        const g = rows[i]?.group
        return (g != null && proposal.groups[g]?.departmentId) || ''
      }
      setRequest((r) => {
        if (r.deliverableTypeId || r.more.length > 0) return r // chosen meanwhile — leave it
        const jobDept = r.departmentId || deptOf(0)
        const more: DeliverableSpec[] = rows.slice(1).map((row, k) => {
          const dept = deptOf(k + 1)
          const other = dept && dept !== jobDept ? dept : ''
          return {
            ...EMPTY_SPEC,
            deliverableTypeId: idForCode(row.typeCode),
            quantity: row.quantity,
            channel: channelFor(row.channel),
            departmentId: other,
            ownerUserId: other ? leadList.find((l) => l.departmentId === other)?.id ?? '' : '',
            suggested: true,
          }
        })
        return {
          ...r,
          departmentId: jobDept,
          deliverableTypeId: idForCode(rows[0]!.typeCode),
          quantity: rows[0]!.quantity,
          channel: channelFor(rows[0]!.channel) || r.channel,
          more,
        }
      })
      setSuggestion('suggested')
    } catch {
      setSuggestion('failed')
    }
  }

  // ADR-0111 (I59.27): the tenant's own filler words, and the refusal said with the field's own name.
  const fillerWords = useFillerWordList()
  const fillerLabel = (key: string): string | null => {
    const f = fields.find((x) => x.key === key)
    return f ? (i18n.language === 'ar' ? f.ar || f.en : f.en) : null
  }
  const onSaveError = (err: unknown) => {
    // I66.12: sent meanwhile (another tab, a double press) — say so, and go to where it can be finished.
    if (isNotDraft(err)) {
      setSentAlready(true)
      setStep(4)
      setError({ message: t('intake.errors.alreadySent'), reportable: false })
      return
    }
    const filler = fillerRefusalMessage(t, err, fillerLabel)
    if (filler) { setError({ message: filler, reportable: false }); return }
    const code = (err as { code?: string }).code
    setError({ message: t(code === '23505' ? 'campaigns.wizard.duplicateName' : 'intake.errors.saveFailed'), reportable: code !== '23505', cause: err })
  }

  /**
   * SJ-v3-01 → SJ-v3-02: the client, the kind of brief and the client's words are what this screen
   * insists on. The job is CREATED here (ADR-0085 d.8's draft, a step earlier than before) under a
   * provisional name, so the receipt files and the brief has somewhere to autosave.
   */
  async function nextFromBriefType() {
    const gaps = briefTypeMissing(request)
    setMissing(gaps)
    if (gaps.length > 0) {
      const names = gaps.map((k) => t(REQUIRED_REQUEST_LABELS[k] ?? k))
      failValidation(t('intake.errors.incompleteList', { fields: names.join(', ') }))
      return
    }
    setError(null)
    setSavingRequest(true)
    try {
      let id = jobId
      let name = request.title.trim() || provisionalTitle()
      if (!id) {
        const start = (n: string) => startDraft.mutateAsync({ clientId: request.clientId, brandId: request.brandId || null, name: n, accountManagerId })
        try {
          id = await start(name)
        } catch (e) {
          // Two jobs begun in the same second for one client: a name clash on a name nobody typed.
          // One retry with a fresh suffix; a second clash is reported like any other failure.
          if ((e as { code?: string }).code !== '23505' || request.title.trim()) throw e
          name = provisionalTitle()
          id = await start(name)
        }
        setJobId(id)
        provisional.current = !request.title.trim()
      }
      await updateDraft.mutateAsync({
        campaignId: id,
        brandId: request.brandId || null,
        name,
        accountManagerId,
        brief: requestRecord(request, ownerId, { ...values, [RISK_KEY]: risk }),
        goLiveAt: null,
      })
      // I48.41: WAIT for the evidence, under the please-wait.
      await recordReceipt(id)
      setStep(2)
    } catch (e) {
      onSaveError(e)
    } finally {
      setSavingRequest(false)
    }
  }

  /** The draft's name until the title is typed on step 3: client, template, the second, and a
   *  short suffix — unique per client (campaign names are), and plainly a placeholder. */
  function provisionalTitle(): string {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const suffix = Math.random().toString(36).slice(2, 6)
    return [clientName, chosenTemplateName, `${iraqDay(now.toISOString())} ${hh}:${mm}:${ss} ${suffix}`].filter(Boolean).join(' · ')
  }

  /** Step 3 (who and when) → review: the title names the job, the record is written, and the
   *  brief — autosaved in the draft until now — becomes its `campaign_briefs` row. Before it: S2
   *  when the date is short (not a block — reduced scope, or more time); after it: S1 when a
   *  similar open job exists (the Figma puts the check here, not on Open). */
  async function nextFromRequest(reducedScopeAccepted = false) {
    const gaps = requestMissing(request)
    setMissing(gaps)
    if (gaps.length > 0) {
      // Name every field that is missing, not a generic "fill in the starred fields" (Edward, B1).
      const names = gaps.map((k) => t(REQUIRED_REQUEST_LABELS[k] ?? k))
      failValidation(t('intake.errors.incompleteList', { fields: names.join(', ') }))
      return
    }
    if (!jobId) {
      failSystem(t('intake.errors.saveFailed'))
      return
    }
    if (leadTime && leadTime.hasDays < leadTime.needsDays && !reducedScopeAccepted && !request.reducedScope) {
      setShortDate(true)
      return
    }
    // Continue on S2 arrives in the same tick as its setState — the record is built from the
    // accepted value, not the state that has not rendered yet.
    const req: RequestDraft = reducedScopeAccepted ? { ...request, reducedScope: true } : request
    setError(null)
    setSavingRequest(true)
    try {
      // I48.34: the brief's "Deliverable Type" field and the typed picker are two records of one
      // fact. Seed the field from the picker when the brief left it empty.
      const briefValues: Record<string, string> = { ...values, [RISK_KEY]: risk, [RULES_KEY]: serializeRules(rules) }
      if (typeName && !(briefValues.deliverableType ?? '').trim() && fieldKeys.includes('deliverableType')) {
        briefValues.deliverableType = typeName
        setValues((v) => ({ ...v, deliverableType: typeName }))
      }
      // The request — title, what is needed, for which department — lands in `campaigns.brief`
      // the way the wizard saves its steps (I40), so a resumed draft opens with what was typed.
      await updateDraft.mutateAsync({
        campaignId: jobId,
        brandId: req.brandId || null,
        name: req.title,
        accountManagerId,
        brief: requestRecord(req, ownerId, briefValues),
        goLiveAt: null,
      })
      provisional.current = false
      if (autosave.current) { clearTimeout(autosave.current); autosave.current = null }
      await saveBrief.mutateAsync({ campaignId: jobId, departmentId: request.departmentId, briefType, values: briefValues })
      setSaveState('saved')
    } catch (e) {
      onSaveError(e)
      setSavingRequest(false)
      return
    }
    setSavingRequest(false)
    // S1: a similar open job on this client, now that the title is known (ADR-0086 d.2). A prompt,
    // not a gate — if the check cannot run, the review is not held hostage; the person is told
    // once, after the release.
    let rows: SimilarJob[] = []
    try {
      rows = await similar.mutateAsync({ clientId: request.clientId, title: request.title, excludeCampaignId: jobId })
    } catch (e) {
      console.warn('similar_open_jobs failed', e)
      similarSkipped.current = true
    }
    if (rows.length > 0) {
      setSimilarJobs(rows)
      return
    }
    setStep(4)
  }

  /**
   * File the screenshot and write the receipt (ADR-0066 d.1, d.2) — the campaign wizard's own
   * routine, on the job's References folder. Never blocks moving on: evidence is optional (d.10)
   * and a failure is said out loud rather than trading the job for the proof of it.
   */
  async function recordReceipt(campaignId: string) {
    // Nothing to record only when there is no new screenshot, no receipt already saved to update,
    // AND no arrival typed by hand. A MANUAL arrival (no image) is a receipt too — the first guard
    // used to return here for it, so a phone/no-screenshot request never persisted and read blank
    // on reload (found 12 Sep). Evidence is optional (ADR-0085 d.5); the arrival is not.
    if (!receipt.image && !savedReceipt.data && !receipt.receivedDate) return
    const image = receipt.image
    let assetId: string | null = savedReceipt.data?.assetId ?? null
    // ADR-0092 (13 Sep): a screenshot that FAILS to file is surfaced, never swallowed. Evidence is
    // still optional (ADR-0085) — the receipt saves without it and the job is not blocked — but the
    // person is told, plainly and reportably, rather than silently losing the Library copy.
    let fileFailed = false
    let fileError: unknown = null
    try {
      if (image) {
        if (filedScreenshot.current?.image === image) {
          assetId = filedScreenshot.current.assetId
        } else {
          const folderId = await fetchCampaignReferencesFolder(campaignId)
          if (folderId) {
            const filed = await fileDocuments.mutateAsync({
              folderId,
              clientId: request.clientId,
              files: [receiptFile(image, receipt.receivedDate, receipt.receivedTime)],
            })
            assetId = filed[0]?.ok ? filed[0].assetId ?? null : null
            if (!filed[0]?.ok) { fileFailed = true; fileError = filed[0]?.error ?? null }
          }
          if (assetId !== null) filedScreenshot.current = { image, assetId }
        }
      }
      // A campaign may hold several receipts (one evidence trail, ADR-0086 d.5), so the write names
      // the row it is correcting; a first write carries no id and inserts.
      const payload: SaveReceipt = {
        id: savedReceipt.data?.id ?? null,
        campaignId,
        assetId,
        subject: receipt.subject,
        receivedDate: receipt.receivedDate,
        receivedTime: receipt.receivedTime,
        timeZone: receipt.timeZone,
        source: receipt.source,
        confirmed: receipt.confirmed,
      }
      await saveReceipt.mutateAsync(payload)
      // The arrival/clock are saved; if only the screenshot filing failed, say so — the request is
      // intact, the Library copy is not, and the person can re-add it or report it (not blocked).
      if (fileFailed) failSystem(t('campaigns.receipt.fileFailed'), fileError)
    } catch (e) {
      console.warn('receipt could not be recorded', e)
      failSystem(t('campaigns.receipt.saveFailed'), e)
    }
  }

  // ---- SJ-03: the brief ----
  function onFieldChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    briefDirty.current = true
    // Typing is the person taking the field over; the marker comes off at once.
    setUnreviewed((u) => u.filter((k) => k !== key))
  }

  function onRiskChange(value: string) {
    setRisk(value)
    briefDirty.current = true
  }

  // Autosave (SJ-v3-02, "Autosaved"): 1.2 s after the last keystroke the brief is written — into
  // the draft's own record while no department has been chosen (there is no row to file it
  // under yet), and to its `campaign_briefs` row as well once there is one. Only once something
  // was typed here (hydration is not a change) and only once the job exists. Next cancels a
  // pending write and saves at once, so nothing is saved twice or out of order.
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (step !== 2 || !briefDirty.current || !jobId || sent) return
    if (autosave.current) clearTimeout(autosave.current)
    autosave.current = setTimeout(() => {
      autosave.current = null
      setSaveState('saving')
      const briefValues = { ...values, [RISK_KEY]: risk, [RULES_KEY]: serializeRules(rules) }
      const draft = updateDraft.mutateAsync({
        campaignId: jobId,
        brandId: request.brandId || null,
        name: provisional.current ? provisionalTitle() : request.title,
        accountManagerId,
        brief: requestRecord(request, ownerId, briefValues),
        goLiveAt: null,
      })
      const row = request.departmentId
        ? saveBrief.mutateAsync({ campaignId: jobId, departmentId: request.departmentId, briefType, values: briefValues })
        : Promise.resolve()
      Promise.all([draft, row]).then(() => setSaveState('saved'), () => setSaveState(null))
    }, 1200)
    return () => { if (autosave.current) clearTimeout(autosave.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, risk, step, jobId, request.departmentId, briefType])

  function onIngested(result: SingleExecutionIngestResult, file: File | null) {
    const merged = fillEmptyFields(values, result.fields, fieldKeys)
    setValues(merged.next)
    if (merged.filled.length > 0) briefDirty.current = true
    setUnreviewed((u) => [...new Set([...u, ...merged.filled])])
    const parts = [
      merged.filled.length === 0
        ? t('campaigns.ingest.filledNone')
        : t('campaigns.ingest.filled', { count: merged.filled.length }),
    ]
    const kept = Object.keys(result.fields).filter((k) => !merged.filled.includes(k) && fieldKeys.includes(k)).length
    if (kept > 0) parts.push(t('campaigns.ingest.skipped', { count: kept }))
    if (result.oversized.length > 0) parts.push(t('campaigns.ingest.oversized', { count: result.oversized.length }))
    setIngestStatus({ text: parts.join(' '), warning: merged.filled.length === 0 || result.oversized.length > 0 })
    // The source document is reference material too (ADR-0084 d.7) — filed, not discarded.
    if (file && jobId) {
      void fetchCampaignReferencesFolder(jobId).then((folderId) => {
        if (!folderId) return
        fileDocuments.mutate(
          { folderId, clientId: request.clientId, files: [file] },
          {
            onSuccess: (results) => {
              const bad = results.find((r) => !r.ok)
              if (bad) failSystem(t('campaigns.ingest.filingFailed', { name: file.name }), bad.error)
            },
            onError: (e) => failSystem(t('campaigns.ingest.filingFailed', { name: file.name }), e),
          },
        )
      })
    }
  }

  /** The panel translates refusals itself, so the mutation's errors pass through untouched. */
  const runIngest = (text: string): Promise<SingleExecutionIngestResult> => ingest.mutateAsync({ text })

  async function nextFromBrief() {
    // Every field the brief filled must be confirmed (Keep) or edited first. The button is no
    // longer disabled — a dead button gave no reason it would not move (found 12 Sep); clicking
    // now says what is needed instead of doing nothing.
    if (pendingKeep.length > 0) {
      setReviewBlocked(true)
      return
    }
    const gaps = briefMissing(values, fields)
    setBriefMissingKeys(gaps)
    if (gaps.length > 0) {
      const first = fields.find((f) => f.key === gaps[0])
      failValidation(t('intake.errors.fieldRequired', { field: (i18n.language === 'ar' && first?.ar) || first?.en || gaps[0] }))
      return
    }
    if (!jobId) {
      failSystem(t('intake.errors.saveFailed'))
      return
    }
    setError(null)
    // Flush a pending autosave into the draft, then on to who and when. The `campaign_briefs`
    // row is written there, once the department is known.
    if (autosave.current) { clearTimeout(autosave.current); autosave.current = null }
    try {
      if (briefDirty.current) {
        await updateDraft.mutateAsync({
          campaignId: jobId,
          brandId: request.brandId || null,
          name: provisional.current ? provisionalTitle() : request.title,
          accountManagerId,
          brief: requestRecord(request, ownerId, { ...values, [RISK_KEY]: risk }),
          goLiveAt: null,
        })
        setSaveState('saved')
      }
      setStep(3)
      void suggestDeliverables()
    } catch (e) {
      onSaveError(e)
    }
  }

  // ---- SJ-v3-05: open the job (ADR-0085; the duplicate check moved to step 3, 22 Sep) ----
  async function onApprove() {
    if (!jobId) return
    // ADR-0083 d.12: a department with no lead, but with team leads, must have one named as the
    // owner before release — not released ownerless. (A department with neither may still be
    // released; there is nobody to name, and the UI never blocks.)
    if (!lead && deptTeamLeads.length > 0 && !picked) {
      setStep(3)
      failValidation(t('intake.errors.ownerRequired'))
      return
    }
    setError(null)
    // The duplicate check ran on Next from who and when (S1); Open releases.
    release()
  }

  /**
   * The release's first half: complete the draft — the stream, the deliverable, the held task
   * list — once. A retry after a failed approval finds the draft already completed and is told so
   * by the database rather than by a flag alone.
   */
  async function ensureCompleted(id: string): Promise<boolean> {
    if (completed) return true
    try {
      await complete.mutateAsync({ campaignId: id, brief: requestRecord(request, ownerId), deliverables: deliverablesPayload() })
      setCompleted(true)
      return true
    } catch (e) {
      if (isNotDraft(e)) { setCompleted(true); return true }
      onSaveError(e)
      return false
    }
  }

  function release() {
    if (!jobId) return
    const id = jobId
    setSimilarJobs(null)
    void ensureCompleted(id).then((ok) => {
      if (!ok) return
      approve.mutate(id, {
        // Released. If the duplicate check could not run, say so once before moving on — the
        // person may want to look for the twin by hand.
        onSuccess: () => (similarSkipped.current ? setSimilarSkippedNotice(id) : navigate(`/campaigns/${id}`)),
        onError: (err) => {
          const e = err as { code?: string; details?: string; hint?: string }
          // ADR-0111 d.2: nothing fake — the field and its text named. An answer, not a failure.
          const filler = fillerRefusalMessage(t, err, fillerLabel)
          if (filler) {
            setError({ message: filler, reportable: false })
          } else if (e.code === '42501') {
            // ADR-0083 addendum d.15: say WHO can. The name rides in the refusal's DETAIL; the hint
            // says whether there is one at all. Not reportable — it is an answer, not a failure.
            const name = (e.details ?? '').trim()
            setError({
              message: name
                ? t('intake.errors.approveScopeNamed', { name })
                : e.hint === 'no_account_manager'
                  ? t('intake.errors.approveScopeNoManager')
                  : t('intake.errors.approveScope'),
              reportable: false,
            })
          } else {
            setError({ message: t('campaigns.review.approveFailed'), reportable: true, cause: err })
          }
        },
      })
    })
  }

  /**
   * The deliverable, its brief, its attachments and its receipt move onto the existing job
   * (ADR-0086 d.5). Completed first, so there IS a deliverable row to move — a draft holds only
   * the specification.
   */
  function onAttach(targetCampaignId: string) {
    if (!jobId) return
    const id = jobId
    void ensureCompleted(id).then((ok) => {
      if (!ok) return
      attach.mutate(
        { draftCampaignId: id, targetCampaignId },
        {
          onSuccess: (target) => navigate(`/campaigns/${target}`),
          onError: (e) => failSystem(t('intake.errors.attachFailed'), e),
        },
      )
    })
  }

  function onCancel() {
    if (!jobId) { navigate('/campaigns'); return }
    setConfirmCancel(true)
  }

  // ---- Render ----
  if (ref.isLoading || template.isLoading || (resumeId && resuming.isLoading)) {
    return <p className="muted" data-testid="sj-loading">…</p>
  }
  if (ref.isError || template.isError || templates.isError) return <p className="form-error">{t('campaigns.wizard.refFailed')}</p>
  if (resumeId && resuming.isSuccess && !resuming.data) {
    return (
      <section data-testid="sj-not-found">
        <p className="form-error">{t('intake.errors.jobNotFound')}</p>
        <Button to="/campaigns" variant="link">{t('campaigns.title')}</Button>
      </section>
    )
  }
  // Released already: there is nothing left for this flow to do, and re-approving is not a thing.
  if (resumeId && resuming.data && resuming.data.status === 'approved') {
    return (
      <section data-testid="sj-released">
        <NoticeBox testId="sj-released-note" lines={[t('intake.errors.alreadyReleased')]} />
        <Button to={`/campaigns/${resuming.data.id}`} variant="link" data-testid="sj-released-open">
          {t('intake.wizard.notDraftOpen')}
        </Button>
      </section>
    )
  }

  const busy = startDraft.isPending || updateDraft.isPending || saveBrief.isPending
  const releasing = similar.isPending || complete.isPending || approve.isPending || attach.isPending
  return (
    <section className="sj-wizard" data-hue={flowHue ?? undefined} data-testid="surface-single-job">
      <StepRail
        steps={[
          { key: 'brief-type', labelKey: 'intake.steps.1' },
          { key: 'request', labelKey: 'intake.steps.2' },
          { key: 'brief', labelKey: 'intake.steps.3' },
          { key: 'review', labelKey: 'intake.steps.4' },
        ]}
        current={step}
      />

      {sent && (
        <NoticeBox
          testId="sj-sent-note"
          lines={[t('intake.wizard.sentWaiting', {
            name: (resuming.data?.accountManagerId && peopleNames.data?.get(resuming.data.accountManagerId)) || t('intake.wizard.sentNoManager'),
          })]}
        />
      )}

      {error && (
        <NoticeDialog
          kind="error"
          message={error.message}
          testId="sj-error"
          reportable={error.reportable}
          reportWhere="New request (single job)"
          reportContext={t('intake.errors.reportContext', {
            job: request.title.trim() || t('intake.errors.reportUntitled'),
            step,
            status: resuming.data?.status ?? (jobId ? 'draft' : 'not saved yet'),
          })}
          reportCause={error.cause}
          onClose={() => setError(null)}
        />
      )}
      {similarSkippedNotice && (
        <NoticeDialog
          kind="info"
          message={t('intake.errors.similarFailed')}
          testId="sj-similar-skipped"
          onClose={() => navigate(`/campaigns/${similarSkippedNotice}`)}
        />
      )}

      {(chosenTemplateRow ? templates.isSuccess : template.isSuccess) && fields.length === 0 && (
        <NoticeBox testId="sj-no-template" lines={[t('intake.errors.noTemplate')]} />
      )}

      <div className="sj-body">
        {step === 1 && (
          <BriefTypeStep
            value={request}
            onChange={(next) => { setRequest(next); if (missing.length) setMissing(briefTypeMissing(next)) }}
            clients={clients}
            brands={brands}
            onBrandAdded={(brandId) => { setRequest((r) => ({ ...r, brandId })); void ref.refetch() }}
            receipt={receipt}
            onReceiptChange={setReceipt}
            filedUrl={filedUrl}
            clockStart={clockStart}
            templates={templates.data ?? []}
            rulesCount={rules.length}
            usage={briefUsage.data ?? {}}
            clientLocked={Boolean(jobId)}
            missing={missing}
          />
        )}

        {step === 3 && (
          <WhoAndWhenStep
            calendar={clientCalendar}
            value={request}
            onChange={(next) => { setRequest(next); if (missing.length) setMissing(requestMissing(next)) }}
            clockStart={clockStart}
            leadTime={leadTime}
            types={activeTypes}
            channels={valuesFor('channel')}
            formats={valuesFor('format')}
            departments={departmentList.filter((d) => d.isProduction !== false)}
            leads={leadList}
            teamLeads={teamLeads.data ?? []}
            ownerPick={ownerPick}
            onOwnerPick={setOwnerPick}
            languageOptions={valuesFor('language').map((v) => ({ code: v.code, label: (i18n.language === 'ar' && v.labelAr) || v.labelEn }))}
            onAddLanguage={(label) => addLanguage.mutateAsync(label)}
            addingLanguage={addLanguage.isPending}
            escalationHours={reminderSettings.data?.assignmentEscalationHours ?? 24}
            missing={missing}
            suggestion={suggestion}
          />
        )}

        {step === 2 && (
          <BriefStep
            templateName={chosenTemplateName ?? t('intake.brief.theBrief')}
            templateNameAlt={chosenTemplate ? (i18n.language === 'ar' ? chosenTemplate.nameEn : chosenTemplate.nameAr) : null}
            departmentName={departmentName}
            clientName={clientName}
            usage={briefUsage.data?.[briefType] ?? null}
            rules={rules}
            rulesFrom={[clientName]}
            words={request.words}
            askedBy={request.askedBy}
            clockStart={clockStart}
            saveState={saveState}
            fields={fields}
            values={values}
            onChange={onFieldChange}
            unreviewed={unreviewed}
            onKeep={(key) => setUnreviewed((u) => u.filter((k) => k !== key))}
            risk={risk}
            onRiskChange={onRiskChange}
            ingest={runIngest}
            onIngested={onIngested}
            ingestStatus={ingestStatus}
            filing={
              jobFolderRoot
                ? { clientId: request.clientId, rootId: jobFolderRoot.id, canManage: can('assets:manage') }
                : null
            }
            missing={briefMissingKeys}
            fillerWords={fillerWords}
          />
        )}

        {step === 4 && (
          <JobReviewStep
            request={request}
            clientName={clientName}
            brandName={brandName}
            typeName={typeName}
            moreNames={request.more.map((m) => [
              typeOf(m.deliverableTypeId)?.nameEn, m.channel,
              // ADR-0138: its own owner and day, when they are not the job's.
              m.departmentId ? leadList.find((l) => l.id === m.ownerUserId)?.name ?? null : null,
              m.dueDate && m.dueDate !== request.dueDate ? formatCalendarDay(m.dueDate) : null,
            ].filter(Boolean).join(' · '))}
            templateName={chosenTemplateName ?? t('intake.brief.theBrief')}
            fieldsCount={fields.length}
            departmentName={departmentName}
            ownerName={ownerName}
            ownerLoadPct={null}
            clockStart={clockStart}
            hasProof={Boolean(receipt.image || savedReceipt.data?.assetId)}
            receiptSubject={receipt.subject}
            referencesFolderId={referencesFolderId}
            leadTime={leadTime}
            rules={rules}
            rulesFrom={[clientName]}
            fields={fields}
            values={values}
            risk={risk}
            onEditRequest={() => setStep(3)}
            onEditBrief={() => setStep(2)}
          />
        )}
      </div>

      <div className="sj-foot">
        {step === 1 && (
          // SJ-v3-01: the frame's arrow button, greyed until a brief is picked (Edward, 26 Sep).
          <Button type="button" variant="arrow" busy={busy} disabled={!chosenTemplate} onClick={() => void nextFromBriefType()} data-testid="sj-next">
            {chosenTemplateName
              ? t('intake.briefType.startNamed', { name: chosenTemplateName })
              : t('intake.briefType.start')}
          </Button>
        )}
        {step === 2 && (
          <Button type="button" variant="primary" busy={busy} onClick={() => void nextFromBrief()} data-testid="sj-next">
            {t('intake.review.nextWhoAndWhen')}
          </Button>
        )}
        {step === 3 && (
          <Button type="button" variant="primary" busy={busy} onClick={() => void nextFromRequest()} data-testid="sj-next">
            {t('intake.review.nextReview')}
          </Button>
        )}
        {step === 4 && (
          <Button type="button" variant="primary" busy={releasing} onClick={() => void onApprove()} data-testid="sj-approve">
            {t('intake.review.openJob')}
          </Button>
        )}
        {step > 1 && !sent && (
          <Button variant="secondary" onClick={() => { setError(null); setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1)) }} data-testid="sj-back">
            {t('campaigns.wizard.back')}
          </Button>
        )}
        <Button variant="secondary" className="wizard-cancel" onClick={onCancel} data-testid="sj-cancel">
          {t('schedule.cancel')}
        </Button>
        {step === 2 && pendingKeep.length > 0 && (
          <span className="muted" data-testid="sj-unreviewed">{t('intake.brief.unreviewed', { n: pendingKeep.length })}</span>
        )}
        {step === 1 && (
          <Button to="/campaigns/new" variant="link" className="sj-foot-link" data-testid="sj-start-campaign">
            {t('intake.briefType.campaignInstead')}
          </Button>
        )}
        {step !== 1 && (
          <span className="sj-foot-note">
            {step === 4 ? (ownerName ? t('intake.review.footNoteNamed', { owner: ownerName }) : t('intake.review.footNote')) : t('intake.brief.nothingSent')}
          </span>
        )}
      </div>

      {similarJobs && (
        <SimilarJobsDialog
          jobs={similarJobs}
          clientName={clientName}
          askedBy={request.askedBy}
          busy={releasing}
          onAttach={onAttach}
          onKeepSeparate={() => { setSimilarJobs(null); setStep(4) }}
          onCancel={() => setSimilarJobs(null)}
        />
      )}

      {shortDate && leadTime && (
        <ShortDateDialog
          dueDay={request.dueDate}
          leadTime={leadTime}
          typeName={typeName}
          onContinue={() => {
            setShortDate(false)
            setRequest((r) => ({ ...r, reducedScope: true }))
            void nextFromRequest(true)
          }}
          onMoreTime={() => setShortDate(false)}
        />
      )}

      {confirmCancel && jobId && (
        <ConfirmDialog
          title={t('intake.cancel.title')}
          message={t('intake.cancel.message')}
          detail={[t('intake.cancel.stays'), t('intake.cancel.nothingAssigned')]}
          confirmLabel={t('intake.cancel.confirm')}
          tone="default"
          onConfirm={() => navigate(completed ? `/campaigns/${jobId}` : '/campaigns')}
          onCancel={() => setConfirmCancel(false)}
          testId="sj-cancel"
        />
      )}

      {reviewBlocked && (
        <NoticeDialog
          kind="info"
          title={t('intake.brief.reviewBlockedTitle')}
          message={t('intake.brief.reviewBlocked')}
          onClose={() => setReviewBlocked(false)}
          testId="sj-review-blocked"
        />
      )}

      {(complete.isPending || approve.isPending || attach.isPending) && (
        <BusyDialog text={t('intake.review.releasing')} testId="sj-busy-release" />
      )}
      {savingRequest && (
        <BusyDialog text={t('intake.request.saving')} testId="sj-busy-request" />
      )}
    </section>
  )
}
