import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { iraqDay } from '../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import {
  useCampaignDraft,
  useCompleteCampaignDraft,
  useStartCampaignDraft,
  useUpdateCampaignDraft,
  useWizardRefData,
  type BriefDeliverable,
} from './api/campaign-api'
import { type BriefIngestResult } from './api/brief-ingest-api'
import { NoticeBox } from '../../components/NoticeBox'
import { Panel } from '../../components/Panel'
import { StepRail } from '../../components/StepRail'
import { Field } from '../../components/Field'
import { Tag } from '../../components/Tag'
import { useDeliverableOwnerCandidates } from '../deliverables/api/deliverables-api'
import { useAccountManagers } from '../clients/api/clients-api'
import { useDepartments } from '../admin/api/admin-api'
import { useWorkflowSteps } from '../admin/api/workflow-templates-api'
import { previewTasks } from '../../lib/deliverables/task-preview'
import {
  useAttributeValues,
  useAddLanguage,
  useDeliverableCatalogue,
  useDeliverableTypes,
} from '../admin/api/deliverable-types-api'
import { Button, BusyNote } from '../../components/Button'
import { BusyDialog } from '../../components/Notice'
import { BriefIngestPanel } from './components/BriefIngestPanel'
import {
  useGenerateDeliverables,
  DeliverablesRefusedError,
} from './api/deliverables-generate-api'
import { applyBriefSuggestions } from '../../lib/brief/merge'
import { BRIEF_FIELD_KEYS, FIELD_HEADINGS, PERFORMANCE_FIELD_KEYS, isBriefFieldKey, isPerformanceField, type BriefFieldKey } from '../../lib/brief/fields'
import type { VocabularyStatus } from '../../lib/brief/deliverables'
import { NoticeDialog } from '../../components/Notice'
import { PersonPicker } from '../../components/PersonPicker'
import { applyGoLiveDates, classifyDueDate, type DueDateArithmetic } from '../../lib/campaigns/go-live-dates'
import { useClientCalendar } from '../../lib/calendar/client-calendar'
import { useSchedulingSettings, DEFAULT_SCHEDULING_SETTINGS } from '../../lib/settings/scheduling-settings-api'
import { isAfterPhaseEnd } from '../../lib/campaigns/go-live-dates'
import { AddBrandDialog } from './components/AddBrandDialog'
import { DocumentFiling } from './components/DocumentFiling'
import {
  fetchCampaignReferencesFolder,
  receiptFile,
  useCampaignReferencesFolder,
  useFileDocuments,
} from './api/document-filing-api'
import { BriefReceiptPanel, EMPTY_RECEIPT, type ReceiptDraft } from './components/BriefReceiptPanel'
import { useBriefReceipt, useSaveBriefReceipt, wallClockIn } from './api/brief-receipt-api'
import { fetchAssetDownloadUrl } from '../library/api/library-api'
import { useBrandFolderRoot, useCampaignFolderRoot } from '../../lib/assets/folders'
import { usePermissions } from '../../app/permissions'
import { InfoTip } from '../../components/InfoTip'
import { useApproveCampaign } from './api/campaign-detail-api'
import { useFillerWordList } from '../../lib/brief/filler-words-api'
import { fillerRefusalMessage } from '../../lib/brief/filler-refusal'
import { CampaignPhasesPanel } from './components/CampaignPhasesPanel'
import { ProposalStep } from './components/ProposalStep'
import { WorkstreamDrawer } from './components/WorkstreamDrawer'
import { useWorkstreamOwnerCandidates } from './api/workstreams-api'
import { orderOwnerCandidates, type WorkstreamOwnerCandidate } from '../../lib/campaigns/workstream-owners'
import { AddPhaseDialog } from './components/AddPhaseDialog'
import { BriefStepContainer } from './components/BriefStepContainer'
import { TimingStepContainer } from './components/TimingStepContainer'
import { DepartmentWeekLoad } from './components/DepartmentWeekLoad'
import { ReviewStepContainer } from './components/ReviewStepContainer'
import { useReminderSettings, DEFAULT_REMINDER_SETTINGS } from '../../lib/settings/reminder-settings-api'
import type { BriefRule } from './components/TheBriefStep'
import type { NewRule } from './components/AddRuleDialog'
import { normalizeRules } from '../../lib/brief/rules'
import { LanguagePicker } from '../../components/LanguagePicker'
import { PieceDialog, type PieceDraft } from './components/PieceDialog'
import { NewWorkstreamDialog } from './components/NewWorkstreamDialog'
import { RemovePieceDialog } from './components/RemovePieceDialog'
import { MoveToWorkstreamDialog } from './components/MoveToWorkstreamDialog'
import { formatPlanRange, planCampaign, previousWorkingDay, startFromDue } from '../../lib/timing/plan-back'
import { leadsOfDepartment } from '../../lib/people/leads-of-department'

/**
 * Brief / Campaign Builder Wizard (ADR-0020, frames 21.1–21.5). Five steps:
 *   1 Job Type      — client, brand, brief type, campaign name
 *   2 Strategy      — the nine strategy fields (authored once)
 *   3 Deliverables  — name · owner · quantity  (ADR-0050: owner, not discipline)
 *   4 Timing        — commence-by / due per deliverable (manual for the pilot)
 *   5 Review        — grouped by the department each owner belongs to → submit
 * On submit it writes one campaign, one stream, and the
 * deliverables, atomically (create_campaign_from_brief). Step 4's automation
 * (SLA-derived dates) is an additive upgrade to the same step later.
 */


interface DeliverableDraft extends BriefDeliverable {
  id: string
  /** UI only, never submitted. Narrows the type list on this row; the CHOSEN TYPE is what carries
   *  the category once one is picked, so this is only consulted while the row is still untyped. */
  categoryHint?: string
  /** ADR-0097 d.2: the brief's own words about this row, shown under it — never its name. */
  note?: string | null
  /** ADR-0097 d.4: the model named something outside the catalogue; the person chooses before
   *  Next. Cleared the moment a catalogue entry is picked. */
  needsType?: boolean
  /** ADR-0099: which workstream holds it, by the DRAFT's id. Null is legal and permanent (d.1). */
  workstreamId?: string | null
  /** I56.8 (CB-v3-P4): the line the creative reads first. */
  contentIdea?: string
  /** I56.8: the account manager's own aside — never the brief's words about the row. */
  notes?: string
  /** I56.7: the ONE language this piece ships in. Several languages is several pieces. */
  language?: string | null
  /** I54.15: high / medium / low, shown as a coloured symbol wherever the piece is listed. */
  priority?: 'high' | 'medium' | 'low' | null
  /** ADR-0101 d.1: the line of the brief a proposed piece came from. Shown, never submitted. */
  from?: string | null
  /** I56.11 (Q4): the due date has been told to the client. A marker only — set on step 4. */
  givenToClient?: boolean
}

/**
 * ADR-0099: a workstream as the wizard holds it, before the campaign exists.
 *
 * Its `id` is a draft id, not a uuid — nothing has been written yet. `create_campaign_from_brief`
 * takes these as a list with the same ids on the deliverables, and resolves them in one statement,
 * so a campaign and its groups are created together or not at all.
 *
 * The department is REQUIRED (d.3): it is what the group sets on the work inside it, and a group
 * without one is the half-state the ADR exists to remove. The owner is optional (d.5) — naming
 * somebody to answer for a group is worth doing with the group in front of you.
 */
interface WorkstreamDraft {
  id: string
  name: string
  /** Empty while a PROPOSED group has none (ADR-0101 d.3); it must be chosen before the work step. */
  departmentId: string
  ownerUserId: string | null
  /** I59.54: the letters the person typed when making it. Absent means the rule's, from the name. */
  codeLetters?: string
}

/** ADR-0096 d.2: a phase as the wizard holds it. Its NUMBER is its position in the list. */
interface PhaseDraft {
  id: string
  name: string
  startsOn: string
  endsOn: string
  /** I56.10 (CB-v3-P1): the event the phase ends on. Everything in it plans back from this. */
  eventName: string
}

interface WizardState {
  clientId: string
  accountManagerId: string
  brandId: string
  name: string
  goLiveAt: string
  background: string
  task: string
  beautifulProblem: string
  audiencePrimary: string
  audienceSecondary: string
  brandFunctionalBenefit: string
  brandEmotionalBenefit: string
  insight: string
  proposition: string
  // Performance-marketing brief (ADR-0021), only for the paid_media brief type.
  perfObjective: string
  perfBudget: string
  perfAudience: string
  perfGeography: string
  perfPlatforms: string
  deliverables: DeliverableDraft[]
  /** ADR-0096 d.1/d.8: the Phases step. Off by default; on, every row must name a phase. */
  hasPhases: boolean
  /** ADR-0101 d.9: whether this campaign's work is grouped into workstreams. On by default. */
  hasWorkstreams: boolean
  phases: PhaseDraft[]
  /** ADR-0099: the campaign's groups. Empty is legal — grouping is optional (d.1). */
  workstreams: WorkstreamDraft[]
  /**
   * I56.6 (CB-v3-02): the campaign's own dos and don'ts. The CLIENT's rules are NOT in here —
   * they sit locked underneath and belong to the client, never to one campaign (ADR-0098).
   */
  rules: BriefRule[]
  /** ADR-0117 d.1: the languages the campaign is made in, in the order chosen. */
  languages: string[]
}

// I34.7: moved to `lib/brief/fields` so the wizard and the campaign page's reader cannot disagree
// about which fields are the performance flight.
const PERFORMANCE_FIELDS = PERFORMANCE_FIELD_KEYS as unknown as Array<keyof WizardState>

const STRATEGY_FIELDS: Array<keyof WizardState> = [
  'background',
  'task',
  'beautifulProblem',
  'audiencePrimary',
  'audienceSecondary',
  'brandFunctionalBenefit',
  'brandEmotionalBenefit',
  'insight',
  'proposition',
]

let seq = 0
function blankDeliverable(): DeliverableDraft {
  seq += 1
  return {
    id: `d${seq}`,
    name: '',
    ownerUserId: '',
    quantity: 1,
    commenceAt: null,
    dueAt: null,
    // ADR-0051 d.7: nullable forever. A row with no type is legal and is submitted as-is; the
    // wizard never blocks on it, because a half-classified brief is still a brief.
    deliverableTypeId: null,
    channel: null,
    format: null,
    phaseNumber: null,
    note: null,
    needsType: false,
    workstreamId: null,
    contentIdea: '',
    notes: '',
    language: null,
    priority: null,
  }
}

function blankPhase(): PhaseDraft {
  seq += 1
  return { id: `p${seq}`, name: '', startsOn: '', endsOn: '', eventName: '' }
}

/**
 * A phase is valid when it is named, has a start date and an end date, and does not end before it
 * starts (Edward, 24 Sep: a phase has a start and an end date). A draft saved before then may hold
 * a first phase with no start; Next names the gap and the dialog asks for it.
 */
function phaseValid(p: PhaseDraft): boolean {
  return Boolean(p.name.trim() && p.startsOn && p.endsOn) && p.endsOn >= p.startsOn
}

/**
 * The phase's start as anything outside the wizard needs it. `campaign_phases.starts_on` is NOT
 * NULL, and the proposal wants a span to place rows inside, so the first phase's "it starts when
 * the campaign does" has to become a day at the point it leaves here — and the day the campaign
 * starts is the day it is created. Held empty in the draft and filled here, rather than the other
 * way round, so a season already under way is never given a start it did not have.
 */
function phaseStart(p: PhaseDraft): string {
  if (p.startsOn) return p.startsOn
  const today = iraqDay(new Date())
  // A season already under way ends its first phase before today, and a start after its own end
  // is not a date anybody can act on. Whatever else is unknown, the phase began by the day it
  // ended, so that is the honest floor.
  return p.endsOn && p.endsOn < today ? p.endsOn : today
}

/** The steps by name. ADR-0096 d.8 put Phases between the brief and the deliverables, so the
 *  proposals can be handed the phase list. */
/**
 * The five steps of `CB-v3` (Edward, 23 Sep). Six became five when Phases moved onto step 1:
 * phases are a property of the campaign — whether it runs in stretches that end on events — not
 * a stage of describing it, and `CB-v3-01` puts the toggle on the campaign panel beside the name.
 *
 * `deliverables` is kept as a second name for `work` rather than renamed through 1,700 lines of
 * wizard and test. The step is the same step; the frame calls the screen "The work" because the
 * thing it collects is now workstreams of pieces rather than a flat table of rows.
 */
const STEP = { identity: 1, brief: 2, work: 3, deliverables: 3, timing: 4, review: 5 } as const
const TOTAL_STEPS = 5

/** Sentinel value for the brand dropdown's "register one" row. Not a uuid, so it cannot collide. */
const ADD_BRAND = '__add_brand__'

/** Stable empty fallbacks, so a query that has not resolved does not invalidate every memo. */
const NO_OWNERS: { id: string; name: string; departmentId: string | null; teamId: string | null }[] = []
const NO_WORKSTREAM_OWNERS: WorkstreamOwnerCandidate[] = []
const NO_DEPARTMENTS: { id: string; name: string }[] = []

/** What the last ingest did, in the terms the user is told about (ADR-0044 §5). */
interface IngestOutcome {
  filled: number
  /** Only fields the USER wrote. A field a previous ingest filled is not their work. */
  keptYours: number
  /** Fields the answer had to drop for length — said out loud, never quietly shortened. */
  oversized: number
  source: BriefIngestResult['source']
}

/**
 * The brief fields the wizard will actually RENDER for a given brief type. The performance
 * fields exist only on a `paid_media` brief, so on any other brief they are not on screen —
 * and a field that cannot be seen cannot be reviewed, marked or corrected. Filling one would
 * make "filled 6 fields — check each one" a count of things the user cannot check.
 *
 * The heading fallback reaches this easily: `budget`, `channels` and `markets` all map to
 * performance fields, so an ordinary 360 brief with a "Budget:" line would over-report.
 */
function visibleBriefFields(): BriefFieldKey[] {
  // ADR-0050 d.5: with no campaign-level brief type, nothing gates which fields appear — they
  // are all on screen, so anything the ingest fills is visible and countable.
  //
  // Kept as a function rather than inlined because the rule it enforces still matters: the
  // merge fills only fields the wizard will actually RENDER, and the reported count describes
  // what is on screen. If per-department brief types ever narrow this again, this is the one
  // place to do it.
  const strategy = STRATEGY_FIELDS.filter((f): f is BriefFieldKey => isBriefFieldKey(f))
  const performance = PERFORMANCE_FIELDS.filter((f): f is BriefFieldKey => isBriefFieldKey(f))
  return [...strategy, ...performance]
}

/**
 * The three pieces of state an ingest moves — the form, the machine-filled markers and the
 * outcome message — live in ONE reducer so they move together.
 *
 * They used to be three `useState`s written from an async callback that had closed over the
 * form from the render where the button was clicked. A model call can take 45 seconds; every
 * keystroke during those 45 seconds was thrown away when the result landed, because the
 * stale snapshot was written back wholesale — and the field the user had just typed into was
 * then reported as "filled from the document", which is the exact inverse of ADR-0044 §5.
 * A reducer is the fix that cannot regress: the merge happens against `state.form` inside the
 * reducer, at the moment the action is applied, and all three parts are derived from it.
 */
interface IngestState {
  form: WizardState
  /**
   * Fields the last ingest filled, still unreviewed. A field leaves this set the moment the
   * user edits it or confirms it — that is what "marked until the user edits or confirms"
   * means, and it is why the marker cannot outlive a person's attention.
   */
  machineFilled: readonly BriefFieldKey[]
  /**
   * Deliverable rows the model proposed and nobody has touched yet (ADR-0048 d.4). Same
   * contract as `machineFilled` one level up: a row leaves the set the moment a person
   * edits it, because that is the moment it stops being a proposal and becomes theirs.
   */
  proposedDeliverables: readonly string[]
  /** ADR-0101: the workstreams the model proposed, by draft id — shown PROPOSED until kept. */
  proposedWorkstreams: readonly string[]
  outcome: IngestOutcome | null
}

type WizardAction =
  | { type: 'setField'; key: keyof WizardState; value: WizardState[keyof WizardState] }
  | { type: 'patch'; apply: (form: WizardState) => WizardState }
  | { type: 'confirm'; key: BriefFieldKey }
  /** `hidden`: fields this person cannot see (the budget without `campaign_budget:view`). Still
   *  filled — hidden on screen, not refused — but not counted in what the status says was filled. */
  | { type: 'ingest'; result: BriefIngestResult; hidden: readonly string[] }
  // ADR-0048 d.4: the model PROPOSES. These rows are marked until a person touches them.
  | { type: 'proposeDeliverables'; rows: DeliverableDraft[]; workstreams: WorkstreamDraft[] }
  | { type: 'touchDeliverable'; id: string }

function reduceWizard(state: IngestState, action: WizardAction): IngestState {
  switch (action.type) {
    case 'setField': {
      const form = { ...state.form, [action.key]: action.value } as WizardState
      // Typing in a field is the user taking ownership of it: the "from the brief"
      // marker comes off immediately, without a separate confirmation step.
      const key = action.key
      const machineFilled = isBriefFieldKey(key)
        ? state.machineFilled.filter((k) => k !== key)
        : state.machineFilled
      return { ...state, form, machineFilled }
    }
    case 'patch':
      return { ...state, form: action.apply(state.form) }
    case 'proposeDeliverables': {
      // Replace only an untouched table. If somebody has already typed a row we leave the
      // whole thing alone rather than merge — a merge would silently reorder their work.
      const existing = state.form.deliverables.filter((d) => d.name.trim() || d.ownerUserId)
      if (existing.length > 0 || action.rows.length === 0) return state
      return {
        ...state,
        form: {
          ...state.form,
          deliverables: action.rows,
          workstreams: [...state.form.workstreams, ...action.workstreams],
        },
        proposedDeliverables: action.rows.map((d) => d.id),
        proposedWorkstreams: action.workstreams.map((w) => w.id),
      }
    }
    case 'touchDeliverable':
      // Editing a proposed row is the person taking ownership of it, exactly as typing in a
      // machine-filled field is. The marker comes off immediately, with no separate step.
      return {
        ...state,
        proposedDeliverables: state.proposedDeliverables.filter((id) => id !== action.id),
      }
    case 'confirm':
      return { ...state, machineFilled: state.machineFilled.filter((k) => k !== action.key) }
    case 'ingest': {
      const merged = applyBriefSuggestions(
        state.form,
        action.result.fields,
        visibleBriefFields(),
      )
      const visible = new Set(visibleBriefFields())
      // "Left exactly as it is" is a promise about the USER's writing. A field a previous
      // ingest filled is still machine-filled and still marked, so counting it here would
      // credit the user with work they did not do.
      const keptYours = merged.skipped.filter((k) => !state.machineFilled.includes(k))
      return {
        form: merged.next,
        machineFilled: [...new Set([...state.machineFilled, ...merged.filled])],
        proposedDeliverables: state.proposedDeliverables,
        proposedWorkstreams: state.proposedWorkstreams,
        outcome: {
          filled: merged.filled.filter((k) => !action.hidden.includes(k)).length,
          keptYours: keptYours.length,
          // The function reports what it dropped for length too; only count what the user
          // would otherwise have expected to see on this brief type.
          oversized:
            merged.oversized.length +
            action.result.oversized.filter((k) => visible.has(k) && !merged.filled.includes(k))
              .length,
          source: action.result.source,
        },
      }
    }
  }
}

export function BriefWizard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { can } = usePermissions()
  // Filing needs `assets:manage`, which the wizard itself does not require (ADR-0044 §8). Said up
  // front rather than discovered on the first upload failure.
  const canFile = can('assets:manage')
  const ref = useWizardRefData()
  const [searchParams] = useSearchParams()
  const resumeId = searchParams.get('draft')
  /** ADR-0086 d.10: a promoted single job opens here at Strategy, step 1 read as done. */
  const openAtStep = Math.min(TOTAL_STEPS, Math.max(1, Number(searchParams.get('step')) || 1))
  const resuming = useCampaignDraft(resumeId)
  const fileDocuments = useFileDocuments()
  const saveReceipt = useSaveBriefReceipt()
  const startDraft = useStartCampaignDraft()
  const updateDraft = useUpdateCampaignDraft()
  const submit = useCompleteCampaignDraft()
  const generateDeliverables = useGenerateDeliverables()

  const [dateNote, setDateNote] = useState<{ filled: number; kept: number } | null>(null)
  // I41.9 / I41.10: the offsets are WORKING days of the tenant's office, with its closures, and the
  // numbers are the tenant's settings — not constants.
  const schedulingSettings = useSchedulingSettings()
  const goLiveRule = (schedulingSettings.data ?? DEFAULT_SCHEDULING_SETTINGS).rule
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  /** A field to take the person to when the refusal is closed — the first unchecked one. */
  const goToAfterError = useRef<string | null>(null)
  // I49.73: the fields a refused Next was missing, by key, so each one is marked where it sits
  // and the sentence names them. Cleared as soon as Next passes.
  const [missing, setMissing] = useState<string[]>([])
  // ADR-0083 addendum d.15 (I49.72): an approval refused for reach is an ANSWER — who can — and
  // it must outlive the wizard. Completing the draft moves the campaign off `draft`, the draft
  // query refetches empty, and the not-a-draft screen would replace this one before the refusal
  // was read; this holds the sentence so that screen carries it instead.
  const [approvalRefused, setApprovalRefused] = useState<string | null>(null)
  /** ADR-0054 d.5: why the proposed rows arrived without types, when they did. Null when the
   *  vocabulary was offered normally — which is the ordinary case and says nothing. */
  const [vocabularyNote, setVocabularyNote] = useState<VocabularyStatus | null>(null)
  /** The model answered and proposed nothing. Legal, and never to be shown as a blank table. */
  const [emptyProposal, setEmptyProposal] = useState(false)
  /** ADR-0097 d.5: how many proposed rows need a person to choose the deliverable. */
  const [needsChoiceCount, setNeedsChoiceCount] = useState(0)
  /** Which phase the `CB-v3-P1` dialog is open on, if any. Null when it is closed. */
  // Step 2's reference files open on request, so the brief keeps the frame's full width.
  const [showReferences, setShowReferences] = useState(false)
  // The work step (CB-v3-02b merged into 03): dropped rows stay on screen, greyed, until *Keep
  // these* — dropping is not deleting while the person is still deciding.
  const [droppedRows, setDroppedRows] = useState<string[]>([])
  const [pendingNext, setPendingNext] = useState(false)
  const [phaseDialog, setPhaseDialog] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null)
  /** The work screen's five doors (CB-v3-P3..P8). Each is a piece or group id, or null. */
  // CB-v3-P5: one workstream opened in the drawer down the right.
  const [openWorkstream, setOpenWorkstream] = useState<string | null>(null)
  const [pieceDialog, setPieceDialog] = useState<{ mode: 'add'; workstreamId: string | null } | { mode: 'edit'; id: string } | null>(null)
  // I57.29: bumped by "Add another" so the dialog remounts blank instead of keeping the saved piece.
  const [pieceDialogRound, setPieceDialogRound] = useState(0)
  const [movingPiece, setMovingPiece] = useState<string | null>(null)
  const [removingPiece, setRemovingPiece] = useState<string | null>(null)
  const [addingWorkstream, setAddingWorkstream] = useState(false)
  const [renamingWorkstream, setRenamingWorkstream] = useState<string | null>(null)
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  /** What setting the go-live just did to the dates, so it is never a silent rewrite. */
/**
   * ADR-0067 d.1: the campaign, created on leaving step 1 so step 2 has folders to file into.
   *
   * This replaces the staged `sourceFile` and the whole promise-then-apologise path ADR-0044 §8
   * needed — there is nothing to stage any more, because the References folder exists from here
   * on and the ingest's source document is filed like any other reference material.
   */
  const [draftId, setDraftId] = useState<string | null>(null)

  /** I35.3: the brand dropdown's "add one" option is open. */
  const [addingBrand, setAddingBrand] = useState(false)
  /**
   * ADR-0066: evidence that this brief was asked for, collected on step 1.
   *
   * Held here until the draft campaign exists, which is one Next press away — the receipt needs a
   * campaign to belong to and the screenshot needs a References folder to be filed in, and neither
   * exists while step 1 is on screen. That is the ONLY thing this wizard still stages, and the
   * window is a button press rather than the five steps ADR-0044 §8 had to hold a file across.
   */
  const [receipt, setReceipt] = useState<ReceiptDraft>(EMPTY_RECEIPT)

  /**
   * Read back the receipt already recorded against this draft (I40).
   *
   * `recordReceipt` has filed the screenshot and written the row since ADR-0066, but nothing ever
   * read either one, so resuming a draft — or simply coming back to step 1 in a new session —
   * showed an empty picker over evidence captured weeks earlier. The obvious response to an empty
   * picker is to upload again, which files a second copy of the same screenshot.
   *
   * A `File` cannot be serialised into the draft, so the image cannot come back as one. It comes
   * back as a URL to the filed asset instead, which is enough to SEE it; choosing a new file still
   * replaces it.
   */
  const savedReceipt = useBriefReceipt(draftId)
  const [filedUrl, setFiledUrl] = useState<string | null>(null)
  const hydratedReceipt = useRef<string | null>(null)

  useEffect(() => {
    const saved = savedReceipt.data
    if (!saved || hydratedReceipt.current === saved.id) return
    hydratedReceipt.current = saved.id
    // `receivedAt` is an INSTANT; the form holds the wall-clock reading a person took off the
    // image. Inverted through the stored zone rather than split off the ISO string, which would
    // return UTC and make a brief received at 14:32 in Baghdad read back as 11:32.
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

  useEffect(() => {
    const assetId = savedReceipt.data?.assetId
    if (!assetId) {
      setFiledUrl(null)
      return
    }
    let live = true
    // Presigned and short-lived (ADR-0022), so it is fetched when the step is open rather than
    // held. A failure here is silent on purpose: the evidence is recorded either way, and a broken
    // thumbnail must not become a reason the brief cannot be written.
    void fetchAssetDownloadUrl(assetId)
      .then((url) => { if (live) setFiledUrl(url) })
      .catch(() => { if (live) setFiledUrl(null) })
    return () => { live = false }
  }, [savedReceipt.data?.assetId])

  /**
   * The screenshot already filed, and the asset row it became.
   *
   * `recordReceipt` runs on EVERY press of Next from step 1, because somebody may have gone back
   * and corrected the date. Without this it would also re-upload the image every time: three trips
   * back and forth would leave three copies of one screenshot in References, with the receipt
   * pointing at the last. `assets` has no unique constraint to catch that — the receipt row does
   * (one per campaign), which is exactly why the duplication would have been silent.
   *
   * Compared by File IDENTITY, not by name: two different screenshots can both be `image.png`.
   */
  const filedScreenshot = useRef<{ image: File; assetId: string | null } | null>(null)

  const [wizard, dispatch] = useReducer(reduceWizard, {
    form: {
      clientId: '',
      accountManagerId: '',
      brandId: '',
      name: '',
      goLiveAt: '',
      background: '',
      task: '',
      beautifulProblem: '',
      audiencePrimary: '',
      audienceSecondary: '',
      brandFunctionalBenefit: '',
      brandEmotionalBenefit: '',
      insight: '',
      proposition: '',
      perfObjective: '',
      perfBudget: '',
      perfAudience: '',
      perfGeography: '',
      perfPlatforms: '',
      deliverables: [blankDeliverable()],
      hasPhases: false,
      hasWorkstreams: true,
      phases: [],
      workstreams: [],
      rules: [],
      languages: [],
    },
    machineFilled: [],
    proposedDeliverables: [],
    proposedWorkstreams: [],
    outcome: null,
  })
  const s = wizard.form
  // ADR-0123 d.3: the chosen client's working week, with the office's closures (was the office's week).
  const { calendar: planningCalendar } = useClientCalendar(s.clientId || null)
  const { machineFilled, proposedDeliverables, proposedWorkstreams, outcome: ingestOutcome } = wizard
  const workstreamOwners = useWorkstreamOwnerCandidates().data ?? NO_WORKSTREAM_OWNERS
  /**
   * ADR-0044, "the result is always reviewed": fields an uploaded brief filled that nobody has kept
   * or edited. Next is refused while any remain (Edward, 24 Sep). A budget this person cannot see is
   * not theirs to review, so it never holds them up.
   */
  const uncheckedFields = machineFilled.filter((k) => k !== 'perfBudget' || can('campaign_budget:view'))

  // The performance fields are still their own section on step 2, shown always now that no
  // campaign-level type gates them (ADR-0050 d.5). Nothing in them is mandatory.
  const isPaidMedia = true

  /**
   * Resuming a draft (ADR-0067 d.3). Runs once, when the query lands: a draft holds only its
   * identity, so this restores step 1 and the person continues from there.
   *
   * Guarded on `draftId` rather than on a ref, because the guard has to survive a re-render from
   * any other source — and once `draftId` is set, this wizard IS that draft and re-applying the
   * fetched values would undo whatever has been typed since.
   */
  useEffect(() => {
    if (draftId || !resuming.data) return
    const d = resuming.data
    setDraftId(d.id)
    if (openAtStep > 1) setStep(openAtStep)
    // Everything the draft holds, not just its identity. Before I40 only the four fields below the
    // brief were restored, so a resumed draft opened with step 1 filled and steps 2 to 4 blank —
    // which reads as "nothing was saved" and is the reason to type it all again.
    const b = (d.brief ?? {}) as Record<string, unknown>
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
    const perf = (b.performance ?? null) as Record<string, string> | null
    const saved = Array.isArray(b.deliverables) ? (b.deliverables as Record<string, unknown>[]) : []
    const savedPhases = Array.isArray(b.phases) ? (b.phases as Record<string, unknown>[]) : []
    const savedWorkstreams = Array.isArray(b.workstreams) ? (b.workstreams as Record<string, unknown>[]) : []
    setS((form) => ({
      ...form,
      hasPhases: savedPhases.length > 0,
      // A draft saved before the switch existed was grouped, which is also the default.
      hasWorkstreams: true,  // ADR-0116 d.2: no switch; every campaign uses workstreams
      languages: Array.isArray(b.languages) ? (b.languages as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      rules: normalizeRules(b.rules).map((r, i) => ({ id: `saved-r${i}`, kind: r.kind, text: r.text, textAr: null, locked: false, from: 'campaign' as const })),
      phases: savedPhases.map((p, i) => ({
        id: `resumed-phase-${i}`,
        name: typeof p.name === 'string' ? p.name : '',
        startsOn: typeof p.startsOn === 'string' ? p.startsOn : '',
        endsOn: typeof p.endsOn === 'string' ? p.endsOn : '',
        // I56.10. A draft saved before the event existed resumes without one, and the phase
        // simply ends on its date until somebody names it — never blank where a name was given.
        eventName: typeof p.eventName === 'string' ? p.eventName : '',
      })),
      clientId: d.clientId,
      brandId: d.brandId ?? '',
      name: d.name,
      accountManagerId: d.accountManagerId ?? '',
      // Slicing the UTC date IS the right inverse here, unlike the receipt's `wallClockIn`: go-live
      // is typed as a bare date with no time and no zone, so it is stored as UTC midnight and comes
      // back as the same calendar day. Converting it into a tenant zone would move it, not fix it.
      // A <input type="date"> wants the day the reader sees, which is the Iraq one (ADR-0076 d.6).
      goLiveAt: d.goLiveAt ? iraqDay(d.goLiveAt) : form.goLiveAt,
      background: str('background'),
      task: str('task'),
      beautifulProblem: str('beautifulProblem'),
      audiencePrimary: str('audiencePrimary'),
      audienceSecondary: str('audienceSecondary'),
      brandFunctionalBenefit: str('brandFunctionalBenefit'),
      brandEmotionalBenefit: str('brandEmotionalBenefit'),
      insight: str('insight'),
      proposition: str('proposition'),
      perfObjective: perf?.objective ?? '',
      perfBudget: perf?.budget ?? '',
      perfAudience: perf?.audience ?? '',
      perfGeography: perf?.geography ?? '',
      perfPlatforms: perf?.platforms ?? '',
      // Row ids are client-side only, so they are minted fresh — nothing downstream keys on them.
      // categoryHint is not restored for the same reason it is not submitted: it only narrows the
      // type list on a row that has no type yet, and a resumed row's type is already saved.
      deliverables: saved.length
        ? saved.map((r, i) => ({
            id: `resumed-${i}`,
            name: typeof r.name === 'string' ? r.name : '',
            ownerUserId: typeof r.ownerUserId === 'string' ? r.ownerUserId : '',
            quantity: typeof r.quantity === 'number' ? r.quantity : 1,
            commenceAt: typeof r.commenceAt === 'string' ? r.commenceAt : null,
            dueAt: typeof r.dueAt === 'string' ? r.dueAt : null,
            deliverableTypeId: typeof r.deliverableTypeId === 'string' ? r.deliverableTypeId : null,
            channel: typeof r.channel === 'string' ? r.channel : null,
            format: typeof r.format === 'string' ? r.format : null,
            phaseNumber: typeof r.phaseNumber === 'number' ? r.phaseNumber : null,
            note: typeof r.note === 'string' ? r.note : null,
            needsType: false,
            // I56.24: the group keeps its draft id across a save, so the piece finds it again.
            workstreamId: typeof r.workstreamId === 'string' ? r.workstreamId : null,
            contentIdea: typeof r.contentIdea === 'string' ? r.contentIdea : '',
            notes: typeof r.notes === 'string' ? r.notes : '',
            language: typeof r.language === 'string' ? r.language : null,
            priority: r.priority === 'high' || r.priority === 'medium' || r.priority === 'low' ? r.priority : null,
            givenToClient: r.givenToClient === true,
          }))
        : form.deliverables,
      workstreams: savedWorkstreams.length
        ? savedWorkstreams
            .filter((w) => typeof w.id === 'string')
            .map((w) => ({
              id: w.id as string,
              name: typeof w.name === 'string' ? w.name : '',
              departmentId: typeof w.departmentId === 'string' ? w.departmentId : '',
              ownerUserId: typeof w.ownerUserId === 'string' ? w.ownerUserId : null,
              ...(typeof w.codeLetters === 'string' && w.codeLetters ? { codeLetters: w.codeLetters } : {}),
            }))
        : form.workstreams,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, resuming.data])

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    dispatch({ type: 'setField', key, value })

  const setS = (apply: (form: WizardState) => WizardState) => dispatch({ type: 'patch', apply })

  const confirmField = (key: BriefFieldKey) => dispatch({ type: 'confirm', key })

  /**
   * Apply an ingest result. Every rule about it — empty fields only, visible fields only,
   * nothing a person typed overwritten, and the counts that are reported — lives in the
   * reducer, where it is applied to the CURRENT form rather than to whatever the form held
   * when the button was pressed.
   */
  function onIngested(result: BriefIngestResult, file: File | null) {
    dispatch({ type: 'ingest', result, hidden: can('campaign_budget:view') ? [] : ['perfBudget'] })
    // ADR-0044 §8 said the source document is filed, not discarded, and had to stage it until
    // submit because the campaign did not exist. Under ADR-0067 it does: this runs on step 2, so
    // the References folder is real and the document goes in now, like any other reference
    // material. Failure is reported and nothing is lost — the file is still on their disk.
    if (file && referencesFolderId) {
      fileDocuments.mutate(
        { folderId: referencesFolderId, clientId: s.clientId, files: [file] },
        {
          onSuccess: (results) => {
            if (results.some((r) => !r.ok)) {
              setError(t('campaigns.ingest.filingFailed', { name: file.name }))
            }
          },
          onError: () => setError(t('campaigns.ingest.filingFailed', { name: file.name })),
        },
      )
    }
  }

  /** The plain-language account of the last ingest, including when the fallback ran. */
  const ingestStatus = (() => {
    if (!ingestOutcome) return null
    const parts: string[] = []
    parts.push(
      ingestOutcome.filled === 0
        ? t('campaigns.ingest.filledNone')
        : t('campaigns.ingest.filled', { count: ingestOutcome.filled }),
    )
    if (ingestOutcome.keptYours > 0)
      parts.push(t('campaigns.ingest.skipped', { count: ingestOutcome.keptYours }))
    if (ingestOutcome.oversized > 0)
      parts.push(t('campaigns.ingest.oversized', { count: ingestOutcome.oversized }))
    if (ingestOutcome.source === 'fallback') parts.push(t('campaigns.ingest.fallbackNotice'))
    return {
      text: parts.join(' '),
      warning:
        ingestOutcome.source === 'fallback' ||
        ingestOutcome.filled === 0 ||
        ingestOutcome.oversized > 0,
    }
  })()


  const clients = ref.data?.clients ?? []
  // ADR-0050 d.1: the Account Manager names an owner per deliverable. Department follows
  // from the person (d.2), so it is never asked for.
  // ADR-0051: the tenant's OWN taxonomy, not a hard-coded list. Pickers show active rows only;
  // the Admin screen is where a tenant switches one off or adds its own.
  // ADR-0097 d.7: the catalogue as the picker wants it — the "260 deliverables", grouped.
  const catalogue = useDeliverableCatalogue()
  const types = useDeliverableTypes()
  const attributeValues = useAttributeValues()
  const addLanguage = useAddLanguage()
  const activeTypes = (types.data ?? []).filter((x) => x.isActive)
  // Edward, 22 Sep (options a + b): the tasks a proposed deliverable WILL produce, previewed on
  // the Deliverables step and at Review — the same list the database writes at Approve, from the
  // same steps (`src/lib/deliverables/task-preview.ts`). A preview only; the real list is reviewed
  // and edited on the department's tab afterwards.
  const workflowSteps = useWorkflowSteps()
  const taskPreviewFor = (d: { deliverableTypeId: string | null; quantity: number }): string[] => {
    const type = d.deliverableTypeId ? (types.data ?? []).find((x) => x.id === d.deliverableTypeId) : undefined
    return previewTasks(workflowSteps.data ?? [], {
      templateId: type?.defaultWorkflowTemplateId ?? null,
      // ADR-0071 addendum (4 Oct): a task names its campaign and the deliverable's type, not the deliverable.
      campaign: s.name,
      typeName: type?.nameEn ?? null,
      quantity: d.quantity,
    }, i18n.language === 'ar' ? 'ar' : 'en')
  }
  const valuesFor = (attr: string) =>
    (attributeValues.data ?? []).filter((v) => v.attribute === attr && v.isActive)
  /** An attribute value in the language being read. The Arabic label is optional, so it
   *  falls back to the English one rather than printing nothing. */
  const attrLabelOf = (v: { labelEn: string; labelAr: string | null }) =>
    (i18n.language === 'ar' ? v.labelAr : null) ?? v.labelEn
  const attrLabel = (attr: string, code: string | null | undefined) => {
    const hit = code ? valuesFor(attr).find((v) => v.code === code) : undefined
    return hit ? attrLabelOf(hit) : undefined
  }


  // NOT `?? []` inline: the fallback is a new array on every render, so any memo keyed on it
  // recomputes every time (the same trap LibraryPage still carries three of).
  // Leads only (ADR-0083 d.9, 11 Sep): a team member is assigned tasks, never handed a deliverable,
  // and the database refuses one — so the picker does not offer one.
  const owners = useDeliverableOwnerCandidates().data ?? NO_OWNERS
  // I73.4: the account manager is chosen among the account managers (holders of account_manager:manage —
  // the campaign page's own list), not among the deliverable owners, who are the department and team leads.
  const accountManagers = useAccountManagers().data ?? NO_OWNERS

  const departments = useDepartments().data ?? NO_DEPARTMENTS
  // ADR-0115: pickers offer only departments that take production work; names still resolve from all.
  const workDepartments = departments.filter((d) => (d as { isProduction?: boolean }).isProduction !== false)
  /** ADR-0045 d.3: how long unassigned work sits before it is chased. A tenant setting. */
  const escalationHours =
    useReminderSettings().data?.assignmentEscalationHours ?? DEFAULT_REMINDER_SETTINGS.assignmentEscalationHours
  const brandsForClient = useMemo(
    () => (ref.data?.brands ?? []).filter((b) => b.clientId === s.clientId),
    [ref.data?.brands, s.clientId],
  )

  // I35.2/I35.4: the roots the two filing panels are fenced to — each panel reads its own level
  // from there (I49.77: the client's whole tree is never held). A brand's folders exist from the
  // moment the brand does (`app.provision_brand_folders`), so step 1 files into a real tree with
  // nothing staged.
  const brandFolderRoot = useBrandFolderRoot(s.brandId || null).data ?? null
  const campaignFolderRoot = useCampaignFolderRoot(draftId).data ?? null
  // Where an ingested brief document is filed (ADR-0044 §8). Provisioned with the campaign, so it
  // is there whenever the draft is — but read defensively, since a tenant may have renamed it.
  const referencesFolderId = useCampaignReferencesFolder(draftId).data ?? null
  const ownerName = (id: string) => owners.find((u) => u.id === id)?.name ?? '—'
  const ownerDepartment = (id: string) => owners.find((u) => u.id === id)?.departmentId ?? null
  /**
   * The department that does a piece: its OWNER's (ADR-0102 — the database stamps it so on
   * approval). Only a piece nobody owns yet falls back to its group's (I57.34: the group came first,
   * so step 4 showed an Edit Lead's TVC as Creative and the campaign saved it as Production).
   * What the timing step's capacity line and the review read.
   */
  const pieceDepartmentId = (d: DeliverableDraft): string | null => {
    const ownersDept = d.ownerUserId ? ownerDepartment(d.ownerUserId) : null
    if (ownersDept) return ownersDept
    const group = s.hasWorkstreams && d.workstreamId ? s.workstreams.find((w) => w.id === d.workstreamId) : null
    return group?.departmentId || null
  }

  const approve = useApproveCampaign()
  // ADR-0111 (I59.27): the tenant's own filler words, for the warning beside each brief field.
  const fillerWords = useFillerWordList()
  // The refusal names a field by its key; say it in the reader's language where the wizard knows it.
  const fillerLabel = (key: string) => (key === 'proposition' ? t('campaigns.strategy.proposition') : null)
  const departmentLabel = (id: string | null) =>
    id ? (departments.find((x) => x.id === id)?.name ?? id) : t('campaigns.wizard.noDepartment')
  const brandLabel = brandsForClient.find((b) => b.id === s.brandId)?.name ?? ''


  const filledDeliverables = s.deliverables.filter((d) => d.name.trim() && d.ownerUserId)

  /**
   * Pieces somebody has named and nobody owns. These are the rows the old filter dropped on the
   * floor: they have a name, so they are real work the account manager typed, but no owner, so
   * they vanished from every count without a word. Now they block, and the step says which.
   */
  const namedWithoutOwner = s.deliverables.filter((d) => d.name.trim() && !d.ownerUserId)
  // ADR-0116 d.3: every kept piece of a campaign is in a workstream — named one by one when it is not.
  const withoutWorkstream = s.deliverables.filter(
    (d) => d.name.trim() && !droppedRows.includes(d.id) && !(d.workstreamId && s.workstreams.some((w) => w.id === d.workstreamId)),
  )

  /**
   * I41.8 (ADR-0075 d.9): what each typed due date means against the go-live. Tight and
   * impossible and after go-live WARN and are allowed (ADR-0093). Tasks do not exist yet at
   * wizard time (traps.md), so the arithmetic here is in working days, not hours.
   */
  const dueDateArithmetic = (dueAt: string | null): DueDateArithmetic | null =>
    dueAt && s.goLiveAt
      ? classifyDueDate({ dueDay: dueAt, goLiveDay: s.goLiveAt, calendar: planningCalendar, rule: goLiveRule })
      : null
  /** True once any row has content, proposed or typed — the signal not to propose over it. */
  const deliverablesTouched = s.deliverables.some((d) => d.name.trim() || d.ownerUserId)

  /**
   * What a piece NEEDS, in working days counting the due day: its type's lead time
   * (`deliverable_types.lead_time_hours`, eight-hour days — the single job's reading, `computeLeadTime`).
   * Null where the type names none, which takes the tenant's run-up in `plan-back`.
   */
  const needsDaysOf = (d: DeliverableDraft): number | null => {
    const hours = d.deliverableTypeId ? (types.data ?? []).find((x) => x.id === d.deliverableTypeId)?.leadTimeHours : null
    return hours && hours > 0 ? Math.max(1, Math.ceil(hours / 8)) : null
  }

  /**
   * The dates a phased campaign's pieces actually get.
   *
   * On `CB-v3-04` a due date is DERIVED — counted back from the event its phase ends on — and it
   * is only stored when somebody pulls a piece earlier. So the draft holds no date for most
   * pieces, and both the gate on leaving this step and the payload that creates the campaign have
   * to read the plan rather than the draft.
   *
   * It is computed by `planCampaign`, the same function the screen draws from, so what the person
   * sees and what is written cannot differ. A campaign with no phases has nothing to count back
   * from and keeps the dates typed into the list.
   */
  const plannedDates = useMemo(() => {
    const out = new Map<string, { dueAt: string; commenceAt: string | null }>()
    if (!(s.phases.length > 0)) return out
    const planPhases = s.phases
      .filter((ph) => ph.endsOn)
      .map((ph) => ({ id: ph.id, name: ph.name, eventName: ph.eventName || null, endsOn: ph.endsOn, startsOn: ph.startsOn || null }))
    const planPieces = s.deliverables
      .filter((d) => d.name.trim() && d.phaseNumber != null && s.phases[d.phaseNumber - 1])
      .map((d) => ({
        id: d.id,
        code: '',
        name: d.name,
        departmentName: null,
        phaseId: s.phases[d.phaseNumber! - 1]!.id,
        needsWorkingDays: needsDaysOf(d),
        pulledDueOn: d.dueAt,
        isEvent: false,
        givenToClient: d.givenToClient === true,
      }))
    for (const phase of planCampaign(planPhases, planPieces, { today: iraqDay(new Date()), calendar: planningCalendar, rule: goLiveRule })) {
      for (const piece of phase.pieces) out.set(piece.id, { dueAt: piece.dueOn, commenceAt: piece.startsOn })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phases, s.deliverables, planningCalendar, goLiveRule, types.data])

  /** The date a piece will actually carry: the one it was pulled to, or the one its phase gives. */
  const dueDateOf = (d: DeliverableDraft): string | null => d.dueAt ?? plannedDates.get(d.id)?.dueAt ?? null

  function stepValid(n: number): boolean {
    // ADR-0073 d.5: the account manager is required here rather than discovered at step 5. They
    // are the intended approver (ADR-0048 d.9), so a campaign with nobody named is one that leans
    // entirely on the failsafe — which d.4 makes possible and this makes unnecessary. The field is
    // pre-filled from the client, so this only bites when the client has no manager either.
    // ADR-0096 d.8: phases on means at least one, each named and dated. They live on this step
    // now (CB-v3-01), so the campaign's identity and its rhythm are valid or invalid together.
    if (n === STEP.identity)
      return (
        Boolean(s.clientId && s.name.trim() && s.accountManagerId) &&
        (!(s.phases.length > 0) || (s.phases.length > 0 && s.phases.every(phaseValid)))
      )
    // ADR-0050 d.5: with no campaign-level brief type there is nothing to make the
    // performance objective conditionally mandatory on. The proposition is the one field a
    // brief cannot proceed without — it is what every downstream brief is written from.
    // ADR-0117 addendum (Q19, 4 Oct): at least one language — no default, the person picks.
    if (n === STEP.brief) return Boolean(s.proposition.trim()) && uncheckedFields.length === 0 && s.languages.length > 0
    // ADR-0097 d.4: a row the model could not place in the catalogue blocks release until chosen.
    //
    // And every named piece has an owner (Edward, 22 and 23 Sep). This used to be silent: a row
    // with no owner was filtered out of `filledDeliverables` and simply did not count, so the step
    // passed while leaving pieces nobody was named on — and nothing said so. The deliverable owner
    // approving the task list (ADR-0100) is that person, so an unowned piece has no second gate.
    if (n === STEP.work)
      return (
        filledDeliverables.length > 0 &&
        !filledDeliverables.some(needsChoice) &&
        !namedWithoutOwner.length &&
        !withoutWorkstream.length
      )
    // ADR-0093 addendum d.7: every row has a due date (never refused for its VALUE — a date after
    // go-live warns and is recorded on submit). ADR-0096 d.8: with phases on, every row has one.
    // With phases, a piece's date comes FROM its phase, so having a phase is having a date —
    // and a piece with neither is the one this refuses, by name.
    if (n === STEP.timing)
      return filledDeliverables.every((d) => Boolean(dueDateOf(d))) && (!(s.phases.length > 0) || filledDeliverables.every((d) => d.phaseNumber != null))
    return true
  }
  /** ADR-0097 d.4: flagged by the model and still without a catalogue entry. */
  const needsChoice = (d: DeliverableDraft) => Boolean(d.needsType) && !d.deliverableTypeId

  /**
   * The sentinel group for work in no workstream. Not a uuid and not a draft id, so it can never
   * be mistaken for one, and it is never submitted — a piece in it goes up with a null workstream.
   *
   * It exists because ungrouped work is a normal, permanent state (ADR-0099 d.1) and the frame has
   * nowhere to draw it: `CB-v3-03` shows a campaign somebody has already organised. Proposals
   * arrive ungrouped by construction — no owners and no departments travel to the model
   * (ADR-0050 d.6), so there is nothing to group them BY until a person says. Hiding them until
   * then would lose the campaign; the UI never blocks and never has a dead end.
   */
  const UNGROUPED = '__ungrouped__'

  const departmentName = (id: string | null | undefined) =>
    departments.find((x) => x.id === id)?.name ?? ''
  /** The group's named person, or nothing. Distinct from `ownerName`, which prints a dash. */
  const groupOwnerName = (id: string | null | undefined) =>
    (id ? owners.find((x) => x.id === id)?.name : null) ?? null

  /** The line under a piece's name: what it is, and how many. The frame's "Static · 3 sizes". */
  function pieceDetail(d: DeliverableDraft): string | null {
    const format = attrLabel('format', d.format)
    const channel = attrLabel('channel', d.channel)
    const many = d.quantity > 1 ? t('work.ofThem', { count: d.quantity }) : null
    const parts = [format, channel, many].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  /**
   * The one thing standing between this piece and Next, said ON the row. An owner first, because
   * it is the one Edward has had to ask for twice and the one the second gate depends on.
   */
  function pieceWarn(d: DeliverableDraft): string | null {
    if (!d.ownerUserId) return t('work.needsOwner')
    if (needsChoice(d)) return t('campaigns.wizard.chooseDeliverable')
    return null
  }


  /**
   * A campaign rule, from `CB-v3-P2`. It travels with every piece in this campaign and it can sit
   * on top of the client's; it can never cancel one, which is why nothing here can touch a locked
   * rule. `because` is kept on the rule itself: the next person reading it wants to know who asked.
   */
  function addRule(r: NewRule) {
    setS((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        {
          id: nextDraftId('r'),
          kind: r.kind,
          text: r.because.trim() ? `${r.text} (${r.because.trim()})` : r.text,
          textAr: null,
          locked: false,
          from: 'campaign' as const,
        },
      ],
    }))
  }

  function removeRule(id: string) {
    // Only the campaign's own. A locked client rule offers no remove at all, so this cannot be
    // reached for one — the guard is here because a list is easier to change than a promise.
    setS((prev) => ({ ...prev, rules: prev.rules.filter((x) => x.id !== id || x.locked) }))
  }

  /** The inline line on a group: one piece, named, and nothing else decided yet. */
  function addPieceToGroup(groupId: string, name: string) {
    const workstreamId = groupId === UNGROUPED ? null : groupId
    const w = s.workstreams.find((x) => x.id === workstreamId)
    setS((prev) => ({
      ...prev,
      deliverables: [
        ...prev.deliverables,
        {
          ...blankDeliverable(),
          name,
          workstreamId,
          // The group's owner is the obvious first answer, and the person can change it in the
          // dialog. A piece that lands owned is a piece that does not block Next.
          ownerUserId: w?.ownerUserId ?? '',
        },
      ],
    }))
  }

  /**
   * The brief as one document, for the model to plan from.
   *
   * ADR-0048 d.3: ONE FLOW. This is assembled from whatever the form holds, and cannot tell
   * whether a person typed it or `ingest-brief` filled it — deliberately. Generation is a
   * property of having complete inputs, not of having used the AI path.
   */
  function assembledBrief(): string {
    const parts: string[] = [`Campaign: ${s.name}`]
    for (const key of visibleBriefFields()) {
      const value = (s[key] as string).trim()
      // FIELD_HEADINGS[key][0] is the canonical human name for the field, and the
      // same word the fallback matcher looks for - so the model reads what a person would.
      if (value) parts.push(`${FIELD_HEADINGS[key][0]}: ${value}`)
    }
    return parts.join('\n\n')
  }

  /** Ask for a proposed deliverable list. Never blocks the step — a failure just leaves it blank. */
  async function proposeDeliverables() {
    if (deliverablesTouched) return
    try {
      setEmptyProposal(false)
      const proposal = await generateDeliverables.mutateAsync({
        brief: assembledBrief(),
        // ADR-0096 d.8 / ADR-0097 d.6: the phases, numbered by position, so the model can say WHEN.
        // Nothing else about the campaign travels (ADR-0050 d.6): no owners, no departments.
        ...((s.phases.length > 0)
          ? { phases: s.phases.map((p, i) => ({ number: i + 1, name: p.name.trim(), startsOn: phaseStart(p), endsOn: p.endsOn })) }
          : {}),
        // ADR-0101 d.9: workstreams off means pieces only — no groups, no department list sent.
        grouped: s.hasWorkstreams,
      })
      // ADR-0097 d.2/d.4: the model returns the tenant's own CODE and the row is named by its
      // catalogue entry, server-side. The code is resolved to the type's id through the same
      // active list the picker is drawn from. A row that came back outside the catalogue arrives
      // flagged (`needsType`) and Next refuses until a person chooses.
      const idForCode = (code: string | null) =>
        (code && activeTypes.find((x) => x.code === code)?.id) || null
      // ADR-0101: the proposed workstreams. A group with no name takes its department's (d.5);
      // one with neither is numbered, and the person names it here.
      const groupDrafts: WorkstreamDraft[] = (s.hasWorkstreams ? proposal.groups : []).map((g, i) => ({
        id: nextDraftId('w'),
        name:
          g.name ??
          (departments.find((d) => d.id === g.departmentId)?.name ?? t('proposal.unnamed', { n: i + 1 })),
        departmentId: g.departmentId ?? '',
        ownerUserId: null,
      }))
      dispatch({
        type: 'proposeDeliverables',
        workstreams: groupDrafts,
        rows: proposal.rows.map((r) => ({
          ...blankDeliverable(),
          workstreamId: r.group != null ? groupDrafts[r.group]?.id ?? null : null,
          from: r.from,
          name: r.name,
          quantity: r.quantity,
          deliverableTypeId: idForCode(r.typeCode),
          needsType: r.needsType || !idForCode(r.typeCode),
          note: r.note,
          channel: r.channel,
          phaseNumber: (s.phases.length > 0) ? r.phaseNumber : null,
        })),
      })
      setNeedsChoiceCount(proposal.needsType)
      // d.5: a vocabulary that could not be offered is SAID, not hidden. No catalogue means no
      // proposals (ADR-0097 d.5), and 'empty' and 'unavailable' are different sentences to the
      // person — only one of them is theirs to fix.
      setVocabularyNote(proposal.vocabulary.types !== 'offered' ? proposal.vocabulary.types : null)
      // A SUCCESSFUL call that proposed nothing is the one outcome this flow could report only by
      // showing an empty table — which is indistinguishable from a failure that was swallowed, and
      // is exactly the 27 August complaint in a new place. It is a legal answer, so it is not an
      // error; it is stated as an outcome so nobody is left guessing which happened.
      setEmptyProposal(proposal.rows.length === 0 && proposal.vocabulary.types === 'offered')
    } catch (e) {
      // A deliberate refusal is something the person can act on; an outage is not, and the
      // hook already returned [] for that. Either way the table stays usable.
      setError(
        e instanceof DeliverablesRefusedError
          ? t(`campaigns.propose.error.${e.code}`)
          : t('campaigns.propose.error.failed'),
      )
    }
  }

  /**
   * Setting the go-live works the dates back from it (Edward, 29 Aug): delivery two days before,
   * commencement four days before that.
   *
   * **Blanks only.** A date already typed is a commitment somebody made, and moving it because the
   * go-live shifted is the silent reschedule `I17` was raised for. The note says how many were left
   * alone, so nothing about it is a surprise.
   */
  function onGoLiveChange(value: string) {
    set('goLiveAt', value)
    const applied = applyGoLiveDates(s.deliverables, value || null, planningCalendar, goLiveRule)
    if (applied.filled === 0 && applied.kept === 0) { setDateNote(null); return }
    setDateNote({ filled: applied.filled, kept: applied.kept })
    dispatch({ type: 'patch', apply: (form) => ({ ...form, deliverables: applied.rows }) })
  }

  function advanceTo(to: number) {
    setStep(to)
    // The brief's proposal lands on the work step (ADR-0101 as amended, Edward 24 Sep: "2b should
    // be step 3 the work"). Asked for once, on an untouched list.
    if (to === STEP.work) void proposeDeliverables()
  }

  /**
   * *Keep these — go to timing* (ADR-0101 d.6, as amended 24 Sep). The unticked pieces go, and a
   * proposed group left with nothing kept goes with them; a kept group must have a department (d.3)
   * and is named in the refusal. Then the step's own Next runs — owners, types, the draft save —
   * on what is left, which is why it waits a render for the pruned state (`pendingNext`).
   */
  function keepAndGoToTiming() {
    const keptRows = s.deliverables.filter((d) => !droppedRows.includes(d.id))
    const keptGroups = s.workstreams.filter(
      (w) => !proposedWorkstreams.includes(w.id) || keptRows.some((d) => d.workstreamId === w.id),
    )
    const noDepartment = keptGroups.filter((w) => !w.departmentId)
    if (noDepartment.length > 0) {
      setError(t('proposal.missingDepartment', { names: noDepartment.map((w) => w.name).join(', ') }))
      return
    }
    if (droppedRows.length === 0 && keptGroups.length === s.workstreams.length) {
      next()
      return
    }
    setS((prev) => ({
      ...prev,
      deliverables: prev.deliverables.filter((d) => !droppedRows.includes(d.id)),
      workstreams: prev.workstreams.filter((w) => keptGroups.some((k) => k.id === w.id)),
    }))
    // A dropped piece is no longer a proposal either.
    for (const id of droppedRows) dispatch({ type: 'touchDeliverable', id })
    setDroppedRows([])
    setPendingNext(true)
  }
  useEffect(() => {
    if (!pendingNext) return
    setPendingNext(false)
    next()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNext])

  /**
   * ADR-0067 d.1: leaving step 1 CREATES the campaign, as a draft. Everything step 1 collects is
   * its identity; the stream and the deliverable ROWS are still written once, at submit.
   *
   * Every later Next SAVES what that step collected into the draft (I40). Nothing is created by
   * it — the text simply lands in `campaigns.brief`, the column submit was going to write anyway —
   * but it is the difference between a resumable draft and one that reopens blank.
   *
   * Going back and forward again UPDATES rather than creating a second one. The name is claimed
   * here (d.5), so a duplicate is reported at step 2 instead of after five steps of typing — that
   * is the `23505` branch below, and it is an improvement rather than a new failure.
   */
  /** What the step is missing, as field keys — the same rule `stepValid` applies, itemised. */
  function missingFor(n: number): string[] {
    if (n === STEP.identity) {
      return [
        ...(s.clientId ? [] : ['client']),
        ...(s.name.trim() ? [] : ['name']),
        ...(s.accountManagerId ? [] : ['accountManager']),
        ...(!(s.phases.length > 0) || (s.phases.length > 0 && s.phases.every(phaseValid)) ? [] : ['phases']),
      ]
    }
    if (n === STEP.brief)
      return [
        ...(s.proposition.trim() ? [] : ['proposition']),
        ...(s.languages.length > 0 ? [] : ['languages']),
        ...(uncheckedFields.length > 0 ? ['unchecked'] : []),
      ]
    if (n === STEP.work) {
      return [
        ...(filledDeliverables.some(needsChoice) ? ['deliverableChoice'] : []),
        ...(namedWithoutOwner.length > 0 ? ['pieceOwner'] : []),
        ...(withoutWorkstream.length > 0 ? ['pieceWorkstream'] : []),
      ]
    }
    if (n === STEP.timing) {
      return [
        ...(filledDeliverables.every((d) => Boolean(dueDateOf(d))) ? [] : ['dueDates']),
        ...(!(s.phases.length > 0) || filledDeliverables.every((d) => d.phaseNumber != null) ? [] : ['phaseOfRow']),
      ]
    }
    return []
  }
  const MISSING_LABEL: Record<string, string> = {
    client: 'campaigns.wizard.client',
    name: 'campaigns.wizard.campaignName',
    accountManager: 'campaigns.wizard.accountManager',
    proposition: 'campaigns.strategy.proposition',
    phases: 'campaigns.phases.missingPhases',
    deliverableChoice: 'campaigns.phases.missingDeliverableChoice',
    pieceOwner: 'campaigns.wizard.missingPieceOwner',
    dueDates: 'campaigns.phases.missingDueDates',
    phaseOfRow: 'campaigns.phases.missingPhaseOfRow',
  }

  // A mark stays only while its field is still missing — filling the field clears it at once. It
  // was set on a refused Next and cleared only by the next good one, so a name typed after the
  // refusal still read "Required before continuing" (seen in the 24 Sep walkthrough).
  const shownMissing = missing.length > 0 ? missing.filter((k) => missingFor(step).includes(k)) : missing

  function next() {
    if (!stepValid(step)) {
      // I49.73: name the field, and mark it where it sits (the single-job request does, I44.15).
      const gaps = missingFor(step)
      setMissing(gaps)
      // Phases switched on with none added is its own answer, not a field to fill (Edward, 24 Sep):
      // add them, or switch them off. Any other gap on the step is still named alongside it.
      const noPhases = step === STEP.identity && (s.phases.length > 0) && s.phases.length === 0
      // Pieces are named one by one, as the brief's fields are (Edward, 24 Sep: "Refuse and name
      // them") — "an owner on every piece" sent the person hunting down the list for which.
      const unowned = gaps.includes('pieceOwner') ? namedWithoutOwner.map((d) => d.name.trim()) : []
      const undated = gaps.includes('dueDates') ? filledDeliverables.filter((d) => !dueDateOf(d)).map((d) => d.name.trim()) : []
      const named = gaps.filter(
        (k) =>
          !(noPhases && k === 'phases') &&
          k !== 'unchecked' &&
          k !== 'languages' &&
          !(k === 'pieceOwner' && unowned.length > 0) &&
          k !== 'pieceWorkstream' &&
          !(k === 'dueDates' && undated.length > 0),
      )
      const sentences = [
        ...(named.length > 0
          ? [t('campaigns.wizard.incompleteNamed', { fields: named.map((k) => t(MISSING_LABEL[k]!)).join(', ') })]
          : []),
        ...(noPhases ? [t('campaigns.wizard.phasesRequired')] : []),
        // Q19: said as its own sentence — what to do, not only what is missing.
        ...(gaps.includes('languages') ? [t('languages.required')] : []),
        ...(unowned.length > 0 ? [t('campaigns.wizard.piecesWithoutOwner', { pieces: unowned.join(', ') })] : []),
        ...(gaps.includes('pieceWorkstream')
          ? [t('campaigns.wizard.piecesWithoutWorkstream', { pieces: withoutWorkstream.map((d) => d.name.trim()).join(', ') })]
          : []),
        ...(undated.length > 0 ? [t('campaigns.wizard.piecesWithoutDate', { pieces: undated.join(', ') })] : []),
        // Named one by one, in the brief's own order, so the person knows exactly what to check.
        ...(gaps.includes('unchecked')
          ? [
              t('campaigns.wizard.uncheckedFields', {
                fields: BRIEF_FIELD_KEYS.filter((k) => uncheckedFields.includes(k))
                  .map((k) => t(`campaigns.${isPerformanceField(k) ? 'performance' : 'strategy'}.${k}`))
                  .join(', '),
              }),
            ]
          : []),
      ]
      // Closing the refusal lands on the first field still to check.
      goToAfterError.current = gaps.includes('unchecked')
        ? `wizard-brief-${BRIEF_FIELD_KEYS.find((k) => uncheckedFields.includes(k))}`
        : null
      setError(sentences.length > 0 ? sentences.join(' ') : t('campaigns.wizard.incomplete'))
      return
    }
    setMissing([])
    setError(null)
    const to = Math.min(TOTAL_STEPS, step + 1)

    const identity = {
      brandId: s.brandId || null,
      name: s.name,
      accountManagerId: s.accountManagerId || null,
    }
    // A failure leaves the wizard on the step it was on with this dialog up, which is the whole
    // behaviour — `advanceTo` is simply never reached, so Next can be pressed again once it is
    // fixed. It also means the wizard never advances while claiming a save that did not happen.
    const onError = (err: unknown) => {
      const code = (err as { code?: string }).code
      setError(t(code === '23505' ? 'campaigns.wizard.duplicateName' : 'campaigns.wizard.draftFailed'))
    }

    if (draftId) {
      updateDraft.mutate(
        // I40: from step 2 onward the brief goes with it, so a draft that is left and resumed opens
        // with what was typed rather than blank. On step 1 it is omitted — undefined means LEAVE
        // ALONE in the RPC, so coming BACK to step 1 and pressing Next cannot erase later steps.
        { campaignId: draftId, ...identity, ...(step === 1 ? {} : draftContent()) },
        {
          onSuccess: () => {
            // Somebody may have added or corrected the receipt before coming forward again.
            if (step === 1) void recordReceipt(draftId)
            advanceTo(to)
          },
          onError,
        },
      )
      return
    }
    // No draft yet can only mean step 1 has not been left, since leaving it is what creates one.
    if (step !== 1) {
      advanceTo(to)
      return
    }
    startDraft.mutate(
      { clientId: s.clientId, ...identity },
      {
        onSuccess: (id) => {
          setDraftId(id)
          void recordReceipt(id)
          advanceTo(to)
        },
        onError,
      },
    )
  }

  /**
   * File the screenshot and write the receipt, now that there is a campaign to hang them on
   * (ADR-0066 d.1, d.2).
   *
   * Never blocks moving on, and never fails the step. Evidence is OPTIONAL (d.10), the image is
   * still on the person's disk, and a wizard that refuses to advance because a screenshot did not
   * upload would be trading the brief for the evidence about it. Failure is said out loud and the
   * brief carries on.
   */
  async function recordReceipt(campaignId: string) {
    if (!receipt.image) return
    const image = receipt.image
    let assetId: string | null = null
    try {
      if (filedScreenshot.current?.image === image) {
        // Same screenshot as last time through — only the typed fields can have changed, and
        // those are an upsert. Re-uploading would leave a second copy in the Library.
        assetId = filedScreenshot.current.assetId
      } else {
        // Filed like any other reference material, so it is versioned, permissioned and
        // downloadable rather than hidden in a column only this feature can read (d.2).
        // Asked for directly, not read from the cached tree: this runs moments after the
        // campaign was created and that cache predates its folders (traps.md).
        const folderId = await fetchCampaignReferencesFolder(campaignId)
        if (folderId) {
          const filed = await fileDocuments.mutateAsync({
            folderId,
            clientId: s.clientId,
            files: [receiptFile(image, receipt.receivedDate, receipt.receivedTime)],
          })
          assetId = filed[0]?.ok ? filed[0].assetId ?? null : null
        }
        // Recorded even when the upload failed (`assetId` null): a retry on the next Next is
        // wanted, but re-filing a screenshot that DID land is not.
        if (assetId !== null) filedScreenshot.current = { image, assetId }
      }
      await saveReceipt.mutateAsync({
        campaignId,
        assetId,
        subject: receipt.subject,
        receivedDate: receipt.receivedDate,
        receivedTime: receipt.receivedTime,
        timeZone: receipt.timeZone,
        source: receipt.source,
        confirmed: receipt.confirmed,
      })
    } catch (e) {
      console.warn('brief receipt could not be recorded', e)
      setError(t('campaigns.receipt.saveFailed'))
    }
  }

  /**
   * Steps 2 to 4, in the shape `create_campaign_from_brief` already takes (I40).
   *
   * Deliberately the SAME shape as submit rather than a second one: `campaigns.brief` is where this
   * ends up either way, so a draft that stores something else would need a translation nobody would
   * remember to keep in step. Deliverables nest inside it, which is why steps 3 and 4 survive a
   * resume without any relational change.
   */
  function draftContent() {
    return {
      brief: {
        background: s.background,
        task: s.task,
        beautifulProblem: s.beautifulProblem,
        audiencePrimary: s.audiencePrimary,
        audienceSecondary: s.audienceSecondary,
        brandFunctionalBenefit: s.brandFunctionalBenefit,
        brandEmotionalBenefit: s.brandEmotionalBenefit,
        insight: s.insight,
        proposition: s.proposition,
        performance: isPaidMedia
          ? {
              objective: s.perfObjective,
              budget: s.perfBudget,
              audience: s.perfAudience,
              geography: s.perfGeography,
              platforms: s.perfPlatforms,
            }
          : null,
        deliverables: s.deliverables.map((d) => ({
          name: d.name,
          ownerUserId: d.ownerUserId,
          quantity: d.quantity,
          commenceAt: d.commenceAt,
          dueAt: d.dueAt,
          deliverableTypeId: d.deliverableTypeId,
          channel: d.channel,
          format: d.format,
          phaseNumber: d.phaseNumber ?? null,
          note: d.note ?? null,
          // I56.24: everything the work and timing steps collect is saved with the draft, or a
          // resumed draft comes back without its groups, ideas and languages.
          workstreamId: d.workstreamId ?? null,
          contentIdea: d.contentIdea ?? '',
          notes: d.notes ?? '',
          language: d.language ?? null,
          priority: d.priority ?? null,
          givenToClient: d.givenToClient === true,
        })),
        phases: (s.phases.length > 0) ? s.phases.map((p) => ({ name: p.name, startsOn: phaseStart(p), endsOn: p.endsOn })) : [],
        hasWorkstreams: s.hasWorkstreams,
        workstreams: s.workstreams.map((w) => ({ id: w.id, name: w.name, departmentId: w.departmentId, ownerUserId: w.ownerUserId, codeLetters: w.codeLetters })),
        languages: s.languages,
        // I56.6: the campaign's own dos and don'ts — kept with the draft (they were lost on leaving).
        rules: s.rules.filter((r) => !r.locked).map((r) => ({ kind: r.kind, text: r.text })),
      } as Record<string, unknown>,
      goLiveAt: s.goLiveAt || null,
    }
  }

  function back() {
    setError(null)
    setStep((n) => Math.max(1, n - 1))
  }

  /**
   * ADR-0067 d.4: submit COMPLETES the draft the wizard created on leaving step 1 — it writes the
   * brief, the one stream and the deliverables, then moves the campaign draft → pending_approval.
   * Client, brand, name and account manager are already on the row and are not sent again.
   *
   * The database refuses a second run, so a double click cannot produce a second stream.
   */
  function onSubmit() {
    if (!draftId) {
      // Only reachable if step 1 never created one, which is `draftFailed` and is already on
      // screen. Restating it beats a submit that silently does nothing.
      setError(t('campaigns.wizard.draftFailed'))
      return
    }
    if (!stepValid(STEP.identity) || !stepValid(STEP.brief) || !stepValid(STEP.work) || !stepValid(STEP.timing)) {
      setError(t('campaigns.wizard.incomplete'))
      return
    }
    setError(null)
    submit.mutate(
      {
        campaignId: draftId,
        goLiveAt: s.goLiveAt || null,
        languages: s.languages,
        rules: s.rules.filter((r) => !r.locked).map((r) => ({ kind: r.kind, text: r.text })),
        strategy: {
          background: s.background,
          task: s.task,
          beautifulProblem: s.beautifulProblem,
          audiencePrimary: s.audiencePrimary,
          audienceSecondary: s.audienceSecondary,
          brandFunctionalBenefit: s.brandFunctionalBenefit,
          brandEmotionalBenefit: s.brandEmotionalBenefit,
          insight: s.insight,
          proposition: s.proposition,
        },
        performance: isPaidMedia
          ? {
              objective: s.perfObjective,
              budget: s.perfBudget,
              audience: s.perfAudience,
              geography: s.perfGeography,
              platforms: s.perfPlatforms,
            }
          : null,
        // ADR-0096 d.8: the phases, numbered by position; every row names one.
        phases: (s.phases.length > 0) ? s.phases.map((p) => ({ name: p.name.trim(), startsOn: phaseStart(p), endsOn: p.endsOn })) : [],
        // I56.24 (ADR-0099 d.1): the groups, made in the same call as the work. Only when the
        // campaign uses them (ADR-0101 d.9), and only those still holding a piece or named on
        // purpose — an empty group is legal, so every one the person kept is sent.
        workstreams: s.hasWorkstreams
          ? s.workstreams.map((w) => ({ key: w.id, name: w.name.trim(), departmentId: w.departmentId, ownerUserId: w.ownerUserId, codeLetters: w.codeLetters }))
          : [],
        deliverables: filledDeliverables.map((d) => {
          // The dates the campaign is actually created with. On a phased campaign most
          // pieces carry no stored date — it is counted back from the phase's event — so the
          // plan is what goes up. Sending `dueAt: null` would create work nobody is due.
          const planned = plannedDates.get(d.id)
          // What the timing step SHOWED is what goes up. With phases that is the plan (a date typed
          // on a Friday is due the Thursday before, and the plan says so); without, it is the
          // piece's own date on a working day, with the start counted back by the piece's needs —
          // the same two numbers its row printed.
          const dueAt = (s.phases.length > 0)
            ? planned?.dueAt ?? d.dueAt ?? null
            : d.dueAt ? previousWorkingDay(d.dueAt, planningCalendar) : null
          const commenceAt = (s.phases.length > 0)
            ? planned?.commenceAt ?? d.commenceAt ?? null
            : dueAt ? startFromDue(dueAt, needsDaysOf(d) ?? goLiveRule.commenceDaysBeforeDelivery, planningCalendar) : d.commenceAt
          const arithmetic = dueDateArithmetic(dueAt)
          const phase = phaseOf(d.phaseNumber)
          return {
            name: d.name,
            ownerUserId: d.ownerUserId,
            quantity: d.quantity,
            commenceAt,
            dueAt,
            // categoryHint is deliberately NOT sent: it narrows the picker, and the chosen type is
            // what carries the category once one exists (ADR-0051 d.5).
            deliverableTypeId: d.deliverableTypeId,
            channel: d.channel,
            format: d.format,
            phaseNumber: (s.phases.length > 0) ? d.phaseNumber : null,
            // I56.24: the group, by the wizard's own draft id, and the piece's own words. These
            // were collected on the work step and never sent — a campaign came out ungrouped.
            workstreamKey: s.hasWorkstreams && d.workstreamId && s.workstreams.some((w) => w.id === d.workstreamId) ? d.workstreamId : null,
            contentIdea: d.contentIdea?.trim() || null,
            notes: d.notes?.trim() || null,
            language: d.language ?? null,
            priority: d.priority ?? null,
            isGivenToClient: d.givenToClient === true,
            // I41.8 / ADR-0093: the warning was shown and the person proceeded — recorded with the row.
            // ADR-0096 d.7: past the phase's end likewise, when go-live raised nothing.
            dueDateOverride:
              arithmetic && (arithmetic.severity === 'tight' || arithmetic.severity === 'impossible' || arithmetic.severity === 'after_go_live')
                ? {
                    severity: arithmetic.severity,
                    workingDaysLeft: arithmetic.workingDaysToGoLive,
                    requiredDays: arithmetic.requiredDays,
                    boundary: 'go_live',
                  }
                : isAfterPhaseEnd(d.dueAt ?? '', phase)
                  ? { severity: 'after_phase_end', workingDaysLeft: 0, requiredDays: 0, boundary: 'phase_end' }
                  : null,
          }
        }),
      },
      {
        // Nothing to file here any more (ADR-0067 d.6): reference materials were filed into real
        // folders as they were chosen, so there is no promise left outstanding at submit.
        // Edward, 4 Sep: step 5 and the approval step are ONE step. So the account manager's
        // last press both creates the campaign and approves it — `approve_campaign` cannot run
        // before the row leaves `draft`, which is why this is sequential rather than one call.
        // If the approval fails the campaign still exists at `pending_approval`, which is the
        // state it would have been left in anyway; the error says so rather than implying the
        // whole thing was lost.
        // ADR-0072 d.8: there is no create-without-approving path out of the wizard. Step 5 IS
        // the approval step, so a campaign left unapproved here would have nowhere to be
        // approved once the separate page goes. `approve_campaign` cannot run before the row
        // leaves `draft`, which is why this is sequential rather than one call — and if the
        // approval fails the campaign still exists at `pending_approval`, which the message says
        // rather than implying the work was lost.
        onSuccess: () => {
          approve.mutate(draftId, {
            onSuccess: () => navigate(`/campaigns/${draftId}`),
            onError: (err) => {
              const e = err as { code?: string; details?: string; hint?: string }
              // ADR-0111 d.2: a field holding only filler is named, with its text.
              const filler = fillerRefusalMessage(t, err, fillerLabel)
              if (filler) {
                setError(filler)
              } else if (e.code === '42501') {
                // Say WHO can. The name rides in the refusal's DETAIL; the hint says whether there
                // is one at all. The same reading as the single-job wizard's release.
                const name = (e.details ?? '').trim()
                setApprovalRefused(
                  name
                    ? t('campaigns.review.approveScopeNamed', { name })
                    : e.hint === 'no_account_manager'
                      ? t('campaigns.review.approveScopeNoManager')
                      : t('campaigns.review.approveScope'),
                )
              } else {
                setError(t('campaigns.review.approveFailed'))
              }
            },
          })
        },
        onError: (err) => {
          const code = (err as { code?: string }).code
          setError(
            fillerRefusalMessage(t, err, fillerLabel) ??
              t(code === '23505' ? 'campaigns.wizard.duplicateName' : 'campaigns.wizard.submitFailed'),
          )
        },
      },
    )
  }

  if (ref.isLoading) return <p className="muted" data-testid="wizard-loading">…</p>
  if (ref.isError) return <p className="form-error">{t('campaigns.wizard.refFailed')}</p>
  // The campaign is saved and pending; only the named account manager can take it further. This
  // stands in for the wizard whether it was reached fresh or by `?draft=`, and before the draft
  // query notices the status moved (see `approvalRefused`).
  if (approvalRefused && draftId) {
    return (
      <section data-testid="wizard-approval-refused">
        <NoticeBox testId="wizard-approval-refused-note" lines={[approvalRefused]} />
        <Button to={`/campaigns/${draftId}`} variant="link" data-testid="wizard-approval-refused-open">
          {t('intake.wizard.notDraftOpen')}
        </Button>
      </section>
    )
  }
  // `useCampaignDraft` answers only for a DRAFT. A link to anything else — a released campaign, a
  // promoted single job whose status the promotion did not reset — would otherwise open a blank
  // step 1 and invite somebody to type it all again under a second name.
  if (resumeId && resuming.isSuccess && !resuming.data) {
    return (
      <section data-testid="wizard-not-draft">
        <NoticeBox testId="wizard-not-draft-note" lines={[t('intake.wizard.notDraft')]} />
        <Button to={`/campaigns/${resumeId}`} variant="link" data-testid="wizard-not-draft-open">
          {t('intake.wizard.notDraftOpen')}
        </Button>
      </section>
    )
  }

  const needsOwners = owners.length === 0

  return (
    <section className="sj-wizard" data-testid="surface-brief-wizard">
      {/* I53.1 (Edward, 20 Sep): the campaign wizard wears the single job's frame — the same head,
          the same step rail, one panel per step, the same footer — so the two doors read as one
          product. The steps themselves are unchanged. */}
      <div className="sj-head">
        <div>
          <h1 className="sj-head-title">{t('campaigns.wizard.title')}</h1>
          <p className="sj-head-sub" data-testid="wizard-intro">{t('campaigns.wizard.intro')}</p>
        </div>
        <div className="sj-head-side">
          <Tag tone="accent">{t('campaigns.wizard.stepOf', { n: step, total: TOTAL_STEPS })}</Tag>
        </div>
      </div>

      <StepRail
        steps={[1, 2, 3, 4, 5].map((n) => ({ key: String(n), labelKey: `campaigns.wizard.steps.${n}` }))}
        current={step}
        testId="wizard"
      />

      {error && (
        <NoticeDialog
          kind="error"
          message={error}
          testId="wizard-error"
          onClose={() => {
            setError(null)
            const target = goToAfterError.current
            goToAfterError.current = null
            if (target) {
              const el = document.querySelector<HTMLElement>(`[data-testid="${target}"]`)
              el?.scrollIntoView?.({ block: 'center' })
              el?.focus()
            }
          }}
        />
      )}

      {addingBrand && s.clientId && (
        <AddBrandDialog
          clientId={s.clientId}
          clientName={clients.find((c) => c.id === s.clientId)?.name ?? ''}
          onCreated={(brandId) => {
            setAddingBrand(false)
            // Select what was just made. Its folders were provisioned by the insert, so the
            // filing panel below has somewhere to file into as soon as this lands.
            set('brandId', brandId)
            void ref.refetch()
          }}
          onCancel={() => setAddingBrand(false)}
        />
      )}

      {/* CB-v3-P1. Add and edit are the same dialog: the same three answers, and only the title
          and the button change. The start is filled from the phase before, never asked for. */}
      {phaseDialog && (
        <AddPhaseDialog
          previousPhase={(() => {
            const before =
              phaseDialog.mode === 'edit'
                ? s.phases[s.phases.findIndex((p) => p.id === phaseDialog.id) - 1]
                : s.phases.at(-1)
            return before && before.endsOn ? { name: before.name, endsOn: before.endsOn } : null
          })()}
          initial={
            phaseDialog.mode === 'edit'
              ? (() => {
                  const p = s.phases.find((x) => x.id === phaseDialog.id)
                  return p ? { name: p.name, startsOn: p.startsOn, endsOn: p.endsOn } : null
                })()
              : null
          }
          onAdd={savePhase}
          onRemove={
            // ADR-0116 d.1: the last phase can go too — then the campaign simply has none.
            phaseDialog.mode === 'edit'
              ? () => {
                  removePhase(phaseDialog.id)
                  setPhaseDialog(null)
                }
              : null
          }
          onCancel={() => setPhaseDialog(null)}
          testId="wizard-phase-dialog"
        />
      )}

      {openWorkstream && (() => {
        const w = s.workstreams.find((x) => x.id === openWorkstream)
        if (!w) return null
        return (
          <WorkstreamDrawer
            name={w.name}
            departmentName={departmentName(w.departmentId)}
            ownerName={groupOwnerName(w.ownerUserId)}
            managerName={groupOwnerName(w.ownerUserId)}
            pieces={s.deliverables
              .filter((d) => d.name.trim() && d.workstreamId === w.id && !droppedRows.includes(d.id))
              .map((d) => ({
                id: d.id,
                name: d.name,
                detail: pieceDetail(d),
                state: 'not_started' as const,
                clientApproved: null,
                phaseName: (s.phases.length > 0) && d.phaseNumber != null ? phaseLabel(d.phaseNumber) : null,
              }))}
            onAddPiece={() => { setOpenWorkstream(null); setPieceDialog({ mode: 'add', workstreamId: w.id }) }}
            onEditPiece={(id) => { setOpenWorkstream(null); setPieceDialog({ mode: 'edit', id }) }}
            onRemovePiece={(id) => { setOpenWorkstream(null); setRemovingPiece(id) }}
            onRename={() => { setOpenWorkstream(null); setRenamingWorkstream(w.id) }}
            onClose={() => setOpenWorkstream(null)}
            testId="wizard-workstream-drawer"
          />
        )
      })()}

      {/* CB-v3-P4 / P8. One dialog, two modes. Everything the old table's columns held lives
          here now — the type, the owner, the quantity — plus the idea, the languages and the
          notes the frames added. */}
      {pieceDialog && (() => {
        const editing = pieceDialog.mode === 'edit' ? s.deliverables.find((d) => d.id === pieceDialog.id) : null
        const wsId = pieceDialog.mode === 'edit' ? (editing?.workstreamId ?? null) : pieceDialog.workstreamId
        const ws = s.workstreams.find((w) => w.id === wsId) ?? null
        return (
          <PieceDialog
            key={pieceDialogRound}
            mode={pieceDialog.mode}
            workstreamName={ws?.name ?? t('work.ungrouped')}
            showWorkstream={s.hasWorkstreams}
            departmentName={ws ? departmentName(ws.departmentId) : t('work.noDepartmentYet')}
            initial={
              editing
                ? {
                    name: editing.name,
                    idea: editing.contentIdea ?? '',
                    notes: editing.notes ?? '',
                    phaseId: editing.phaseNumber != null ? String(editing.phaseNumber) : null,
                    deliverableTypeId: editing.deliverableTypeId,
                    format: editing.format,
                    channel: editing.channel,
                    priority: editing.priority ?? null,
                    quantity: editing.quantity,
                    ownerUserId: editing.ownerUserId || null,
                    languages: editing.language ? [editing.language] : [],
                  }
                : { ownerUserId: ws?.ownerUserId ?? null }
            }
            phases={
              (s.phases.length > 0)
                ? s.phases.map((ph, i) => ({ id: String(i + 1), label: `${i + 1}. ${ph.name || t('campaigns.phases.phase')}` }))
                : []
            }
            types={catalogue.items.map((x) => ({ id: x.id, label: x.name }))}
            formats={valuesFor('format').map((v) => ({ id: v.code, label: attrLabelOf(v) }))}
            channels={valuesFor('channel').map((v) => ({ id: v.code, label: attrLabelOf(v) }))}
            // I66.9: the piece's workstream's department's leads — every lead only for an ungrouped piece.
            owners={leadsOfDepartment(owners, ws?.departmentId || null).map((o) => ({ id: o.id, label: o.name }))}
            taskPreview={(typeId) => taskPreviewFor({ deliverableTypeId: typeId, quantity: editing?.quantity ?? 1 })}
            // ADR-0117 d.7: a piece's language is one of the campaign's; with none chosen, any.
            languages={valuesFor('language')
              .filter((v) => s.languages.length === 0 || s.languages.includes(v.code))
              .map((v) => ({ id: v.code, label: attrLabelOf(v) }))}
            onSave={(draft) => { savePiece(draft, wsId); setPieceDialog(null) }}
            onSaveAndAddAnother={pieceDialog.mode === 'add' ? (draft) => { savePiece(draft, wsId); setPieceDialog({ mode: 'add', workstreamId: wsId }); setPieceDialogRound((n) => n + 1) } : undefined}
            onRemove={editing ? () => { setRemovingPiece(editing.id); setPieceDialog(null) } : undefined}
            onCancel={() => setPieceDialog(null)}
            testId="wizard-piece"
          />
        )
      })()}

      {/* CB-v3-P3. Two fields, because two is all a group needs — the pieces come after. */}
      {addingWorkstream && (
        <NewWorkstreamDialog
          departments={workDepartments}
          takenNames={s.workstreams.map((w) => w.name)}
          onCreate={(name, dept, codeLetters) => {
            setS((prev) => ({ ...prev, workstreams: [...prev.workstreams, { id: nextDraftId('w'), name, departmentId: dept, ownerUserId: null, codeLetters }] }))
            setAddingWorkstream(false)
          }}
          onCancel={() => setAddingWorkstream(false)}
          testId="wizard-new-workstream"
        />
      )}

      {/* I57.27. The drawer's Rename — the same dialog, the name only. */}
      {renamingWorkstream && (() => {
        const w = s.workstreams.find((x) => x.id === renamingWorkstream)
        if (!w) return null
        return (
          <NewWorkstreamDialog
            departments={workDepartments}
            takenNames={s.workstreams.map((x) => x.name)}
            onCreate={() => {}}
            renaming={{
              name: w.name,
              onRename: (name) => {
                setS((prev) => ({ ...prev, workstreams: prev.workstreams.map((x) => (x.id === w.id ? { ...x, name } : x)) }))
                setRenamingWorkstream(null)
              },
            }}
            onCancel={() => setRenamingWorkstream(null)}
            testId="wizard-rename-workstream"
          />
        )
      })()}

      {/* CB-v3-P6. The reason is required and it goes on the record — a piece vanishing without
          one is how an agency ends up arguing about what was agreed. Nothing is written yet at
          wizard time, so this drops the draft row and the reason goes with the campaign. */}
      {removingPiece && (
        <RemovePieceDialog
          pieceName={s.deliverables.find((d) => d.id === removingPiece)?.name ?? ''}
          workstreamName={
            s.workstreams.find((w) => w.id === s.deliverables.find((d) => d.id === removingPiece)?.workstreamId)?.name
            ?? t('work.ungrouped')
          }
          onRemove={() => {
            setS((prev) => ({ ...prev, deliverables: prev.deliverables.filter((d) => d.id !== removingPiece) }))
            setRemovingPiece(null)
          }}
          onCancel={() => setRemovingPiece(null)}
          testId="wizard-remove-piece"
        />
      )}

      {/* I56.15. The move existed in the database since 22 Sep with nowhere to press it. */}
      {movingPiece && (() => {
        const piece = s.deliverables.find((d) => d.id === movingPiece)
        const ws = s.workstreams.find((w) => w.id === piece?.workstreamId) ?? null
        return (
          <MoveToWorkstreamDialog
            pieceName={piece?.name ?? ''}
            currentWorkstreamId={piece?.workstreamId ?? null}
            currentDepartmentName={ws ? departmentName(ws.departmentId) : null}
            options={s.workstreams.map((w) => ({
              id: w.id,
              name: w.name,
              departmentName: departmentName(w.departmentId),
              pieceCount: s.deliverables.filter((d) => d.name.trim() && d.workstreamId === w.id && !droppedRows.includes(d.id)).length,
            }))}
            allowUngrouped={false}  // ADR-0116 d.3: a campaign piece moves between workstreams only
            onMove={(to) => {
              setS((prev) => ({
                ...prev,
                deliverables: prev.deliverables.map((d) => (d.id === movingPiece ? { ...d, workstreamId: to } : d)),
              }))
              setMovingPiece(null)
            }}
            onCancel={() => setMovingPiece(null)}
            testId="wizard-move-workstream"
          />
        )
      })()}

      {/* CB-v3-P5. A drawer, because the point of opening a group is to read it against the rest
          of the screen. Nothing is delivered at wizard time, so every piece reads as not started
          — which is true, and is what the strip is for. */}

      <div className="wizard-body sj-body">
        {step === STEP.identity && (
          <div className="sj-step" data-testid="wizard-step-1">
            <div className="sj-cols">
              {/* LEFT — the campaign: whose it is, what it is called, who approves it, and the
                  evidence the brief was asked for (ADR-0066). The single job's left panel, one for one. */}
              <Panel title={t('campaigns.wizard.panelCampaign')} tag={t('campaigns.wizard.panelCampaignTag')} testId="wizard-panel-campaign">
                <Field label={t('campaigns.wizard.campaignName')} required error={shownMissing.includes('name') ? t('campaigns.wizard.fieldRequired') : undefined}>
                  <input value={s.name} aria-invalid={shownMissing.includes('name') || undefined} onChange={(e) => set('name', e.target.value)} data-testid="wizard-name" />
                  {shownMissing.includes('name') && <span className="sr-only" data-testid="wizard-name-missing">{t('campaigns.wizard.fieldRequired')}</span>}
                </Field>
                <div className="field-row">
                  <Field label={t('campaigns.wizard.client')} required>
                    <select
                      value={s.clientId}
                      onChange={(e) => {
                        const id = e.target.value
                        set('clientId', id)
                        set('brandId', '')
                        // "The default is the Client Manager" (Edward, 29 Aug). Pre-filled, not locked:
                        // a campaign often runs under somebody other than the client's usual AM.
                        set('accountManagerId', clients.find((c) => c.id === id)?.accountManagerId ?? '')
                      }}
                      aria-invalid={shownMissing.includes('client') || undefined}
                      data-testid="wizard-client"
                    >
                      <option value="" disabled>{t('campaigns.wizard.selectClient')}</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('campaigns.wizard.brand')}>
                    {/* I35.3: the "add one" option is IN the dropdown, because that is where somebody
                        looks when the brand they want is not there. Choosing it opens the modal and
                        leaves the selection untouched, so cancelling changes nothing. */}
                    <select
                      value={s.brandId}
                      onChange={(e) => {
                        if (e.target.value === ADD_BRAND) { setAddingBrand(true); return }
                        set('brandId', e.target.value)
                      }}
                      disabled={!s.clientId}
                      data-testid="wizard-brand"
                    >
                      <option value="">{t('campaigns.wizard.brandNone')}</option>
                      {brandsForClient.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      <option value={ADD_BRAND}>{t('campaigns.wizard.brandAdd')}</option>
                    </select>
                  </Field>
                </div>
                {/* Approval resolves coalesce(campaign, client), and a campaign under a client with no
                    account manager could be approved by NOBODY — it sat at pending_approval for ever,
                    with nothing under it assignable (ADR-0048 d.8). Asked here, defaulted from the
                    client. ADR-0073 d.5 — required, marked the way every other required field is. */}
                <Field
                  label={t('campaigns.wizard.accountManager')}
                  required
                  as="div"
                  hint={`${t('campaigns.wizard.accountManagerNote')} ${t('campaigns.wizard.accountManagerApprover')}`}
                >
                  <PersonPicker
                    people={accountManagers}
                    value={s.accountManagerId}
                    onChange={(id) => set('accountManagerId', id)}
                    placeholder={t('campaigns.wizard.accountManagerHint')}
                    testId="wizard-account-manager"
                  />
                </Field>

                {/* ADR-0066. Placed on step 1 at Edward's ask (3 Sep). The campaign does not exist
                    yet, so this collects and reads; the wizard writes it when the draft is created. */}
                <BriefReceiptPanel value={receipt} onChange={setReceipt} filedUrl={filedUrl} />
              </Panel>

              {/* RIGHT — the brand's documents (I35.2), and the phases under them (Edward, 24 Sep).
                  The documents only once a brand is chosen: they are filed under the BRAND, so
                  without one there is no folder to put them in. */}
              <div className="sj-col-stack">
                <Panel
                title={
                  <>
                    {t('campaigns.filing.brandTitle')}
                    <InfoTip
                      label={t('campaigns.filing.brandTitle')}
                      lines={[t('campaigns.filing.brandHint'), t('campaigns.filing.brandHintNext')]}
                      testId="brand-filing-hint"
                    />
                  </>
                }
                tag={t('campaigns.wizard.panelDocumentsTag')}
                testId="wizard-panel-documents"
              >
                  {brandFolderRoot ? (
                    <DocumentFiling
                      clientId={s.clientId}
                      rootId={brandFolderRoot.id}
                      title=""
                        canManage={canFile}
                      testId="brand-filing"
                    />
                  ) : (
                    <p className="field-hint" data-testid="wizard-documents-none">{t('campaigns.wizard.panelDocumentsNoBrand')}</p>
                  )}
                </Panel>

                {/* ADR-0096. Turning phases on does not invent one: the panel shows "+ Add a phase",
                    and Next refuses — saying to add phases or switch them off — until one exists. */}
                <CampaignPhasesPanel
                  phases={s.phases.map((p, i) => ({
                    id: p.id,
                    name: p.name || t('campaigns.phases.phase') + ' ' + String(i + 1),
                    dates: phaseDates(p),
                  }))}
                  onAddPhase={() => setPhaseDialog({ mode: 'add' })}
                  onEditPhase={(id) => setPhaseDialog({ mode: 'edit', id })}
                  testId="wizard-phases"
                />

                {/* ADR-0116 d.2 (Edward, 27 Sep): no Workstreams switch — every campaign uses them. */}
              </div>
            </div>
          </div>
        )}

        {step === STEP.brief && (
          <div className="sj-step" data-testid="wizard-step-2">
            {/* CB-v3-02, full width. The same fourteen fields, read as one page in four named parts
                with the dos and don'ts as a fifth. ONE drop zone, and it is the one that reads
                (Edward, 24 Sep): the compact ingest control, with "Paste text instead" for a brief
                that arrives as a message. The reference files are a line under it, opened only when
                wanted, so the brief keeps the width the frame gives it. */}
            <BriefStepContainer
              values={s as unknown as Record<BriefFieldKey, string>}
              machineFilled={machineFilled}
              rules={s.rules}
              ruleLocales={valuesFor('language').map((v) => ({ value: v.code, label: attrLabelOf(v) }))}
              onFieldChange={(k, v) => set(k as keyof WizardState, v as WizardState[keyof WizardState])}
              onConfirmField={confirmField}
              onAddRule={addRule}
              onRemoveRule={removeRule}
              showBudget={can('campaign_budget:view')}
              requiredFields={['proposition']}
              missingFields={shownMissing.includes('proposition') ? ['proposition'] : []}
              missingText={t('campaigns.wizard.fieldRequired')}
              fillerWords={fillerWords}
              bottom={
                // ADR-0117 d.1 (Edward, 27 Sep): the languages the campaign is made in. Every
                // deliverable's task list gets one translation task naming them.
                <section className="brief-card" data-testid="wizard-languages">
                  <header className="brief-card-head">
                    <h3 className="brief-card-name">{t('languages.title')}</h3>
                    <InfoTip label={t('languages.title')} lines={[t('languages.hint')]} />
                  </header>
                  <LanguagePicker
                    options={valuesFor('language').map((v) => ({ code: v.code, label: attrLabelOf(v) }))}
                    value={s.languages}
                    onChange={(codes) => setS((prev) => ({ ...prev, languages: codes }))}
                    onAdd={(label) => addLanguage.mutateAsync(label)}
                    adding={addLanguage.isPending}
                    testId="wizard-languages-picker"
                  />
                  {shownMissing.includes('languages') && (
                    <span className="field-error" role="status" data-testid="wizard-languages-missing">{t('languages.required')}</span>
                  )}
                </section>
              }
              top={
                <>
                  {/* ADR-0044: the brief can arrive as a document, and what it filled is marked
                      on the fields it filled. */}
                  <BriefIngestPanel
                    compact
                    onIngested={onIngested}
                    statusMessage={ingestStatus?.text ?? null}
                    statusIsWarning={ingestStatus?.warning}
                    sourceNoteKey="campaigns.ingest.sourceNoteCampaign"
                  />
                  {/* Reference material (I35.4). The campaign exists by now — leaving step 1
                      created it as a draft — so its folders are real and these upload at once. */}
                  <div className="brief-references" data-testid="wizard-references">
                    <div className="brief-references-row">
                      <Button
                        variant="link"
                        size="sm"
                        icon={showReferences ? undefined : 'plus'}
                        aria-expanded={showReferences}
                        onClick={() => setShowReferences((v) => !v)}
                        data-testid="wizard-references-toggle"
                      >
                        {t(showReferences ? 'campaigns.wizard.referencesHide' : 'campaigns.wizard.referencesShow')}
                      </Button>
                      <InfoTip
                        label={t('campaigns.wizard.referencesShow')}
                        lines={[t('campaigns.filing.campaignHint')]}
                        testId="campaign-filing-hint"
                      />
                    </div>
                    {showReferences &&
                      (campaignFolderRoot ? (
                        <DocumentFiling
                          clientId={s.clientId}
                          rootId={campaignFolderRoot.id}
                          title=""
                          canManage={canFile}
                          testId="campaign-filing"
                        />
                      ) : (
                        <p className="field-hint" data-testid="wizard-references-none">{t('campaigns.wizard.panelReferencesNone')}</p>
                      ))}
                  </div>
                </>
              }
              testId="wizard-brief"
            />
          </div>
        )}

        {step === STEP.deliverables && (
          <div className="sj-step" data-testid="wizard-step-3">
            <Panel title={t('campaigns.wizard.steps.3')} tag={t('campaigns.wizard.panelDeliverablesTag')} testId="wizard-panel-deliverables">
            {needsOwners && (
              <p className="form-error" data-testid="wizard-no-disciplines">{t('campaigns.wizard.noDisciplines')}</p>
            )}
            {/* ADR-0048 d.4: proposals are stated, never silent. A row nobody reads is a
                booking nobody chose. */}
            {/* Both: the note keeps the step's own layout stable while the rows are replaced, and
                the dialog blocks a second Next during a call that takes seconds (Edward, 29 Aug). */}
            {generateDeliverables.isPending && (
              <>
                <BusyNote text={t('campaigns.propose.running')} />
                <BusyDialog text={t('campaigns.propose.running')} testId="wizard-busy-propose" />
              </>
            )}
            {/* The work step with the brief's proposal on it (CB-v3-02b merged into 03; Edward, 24
                Sep). Proposed pieces carry a keep/drop tick and the line they came from; pieces
                the person adds are plain work. Each row still says what it needs before timing. */}
            {!generateDeliverables.isPending && (
              <ProposalStep
                ungroupedAllowed={false}
                groups={s.workstreams.map((w) => ({
                  id: w.id,
                  name: w.name,
                  departmentId: w.departmentId || null,
                  ownerUserId: w.ownerUserId,
                  proposed: proposedWorkstreams.includes(w.id),
                  // I66.9: only the group's own department's leads (every lead while it has no department).
                  ownerChoices: orderOwnerCandidates(
                    leadsOfDepartment(workstreamOwners, w.departmentId || null),
                    w.departmentId || null,
                    (id) => departments.find((d) => d.id === id)?.name ?? '',
                  ).map((p) => ({
                    id: p.id,
                    name: p.name,
                    hint: departments.find((d) => d.id === p.departmentId)?.name ?? null,
                  })),
                }))}
                rows={s.deliverables
                  .filter((d) => d.name.trim())
                  .map((d) => ({
                    id: d.id,
                    groupId: d.workstreamId ?? null,
                    name: d.name,
                    meta: [
                      d.from ? t('proposal.from', { quote: d.from }) : pieceDetail(d),
                      (s.phases.length > 0) && d.phaseNumber != null ? phaseLabel(d.phaseNumber) : null,
                      d.quantity > 1 ? `×${d.quantity}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    proposed: proposedDeliverables.includes(d.id),
                    kept: !droppedRows.includes(d.id),
                    warn: pieceWarn(d),
                  }))}
                departments={workDepartments}
                status={
                  emptyProposal
                    ? t('campaigns.propose.none')
                    : vocabularyNote
                      ? t(`campaigns.propose.untyped.${vocabularyNote}`)
                      : // ADR-0097 d.5: the person is told how many rows need a choice.
                        needsChoiceCount > 0
                        ? t('campaigns.propose.needsChoice', { count: needsChoiceCount })
                        : null
                }
                onToggleRow={(id) =>
                  setDroppedRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                }
                onKeepAll={(gid) => {
                  const ids = s.deliverables.filter((d) => (d.workstreamId ?? null) === gid).map((d) => d.id)
                  setDroppedRows((prev) => prev.filter((x) => !ids.includes(x)))
                }}
                onDropAll={(gid) => {
                  const ids = s.deliverables
                    .filter((d) => (d.workstreamId ?? null) === gid && proposedDeliverables.includes(d.id))
                    .map((d) => d.id)
                  setDroppedRows((prev) => [...new Set([...prev, ...ids])])
                }}
                onEditRow={(id) => setPieceDialog({ mode: 'edit', id })}
                onAddToGroup={(gid) => setPieceDialog({ mode: 'add', workstreamId: gid })}
                onQuickAdd={(gid, name) => addPieceToGroup(gid ?? UNGROUPED, name)}
                onMoveRow={s.hasWorkstreams && s.workstreams.length > 0 ? (id) => setMovingPiece(id) : null}
                onRemoveRow={(id) => setRemovingPiece(id)}
                onNewWorkstream={() => setAddingWorkstream(true)}
                onOpenGroup={(id) => setOpenWorkstream(id)}
                onRenameGroup={(id, name) =>
                  setS((prev) => ({ ...prev, workstreams: prev.workstreams.map((w) => (w.id === id ? { ...w, name } : w)) }))
                }
                onSetDepartment={(id, departmentId) =>
                  setS((prev) => ({ ...prev, workstreams: prev.workstreams.map((w) => (w.id === id ? { ...w, departmentId } : w)) }))
                }
                onSetOwner={(id, ownerUserId) =>
                  setS((prev) => ({ ...prev, workstreams: prev.workstreams.map((w) => (w.id === id ? { ...w, ownerUserId } : w)) }))
                }
                grouping={s.hasWorkstreams}
                testId="wizard-work"
              />
            )}
            </Panel>
          </div>
        )}

        {step === STEP.timing && (
          <div className="sj-step" data-testid="wizard-step-4">
            {/* CB-v3-04, with the Edit on every phase and every piece Edward asked for (24 Sep). A
                campaign with phases plans every piece back from its phase's end; one without has a
                date per piece — the same screen, the same rows and the same dialog, as one list.
                Every warning the old grid carried still fires, on the row it is about, and the
                same override is recorded on submit. */}
            <TimingStepContainer
              phases={(s.phases.length > 0) ? s.phases.map((p) => ({ id: p.id, name: p.name, startsOn: p.startsOn, endsOn: p.endsOn })) : []}
              pieces={filledDeliverables.map((d) => {
                const departmentId = pieceDepartmentId(d)
                return {
                  id: d.id,
                  code: '',
                  name: d.name,
                  departmentId,
                  departmentName: departmentName(departmentId) || null,
                  phaseId: (s.phases.length > 0) && d.phaseNumber != null ? s.phases[d.phaseNumber - 1]?.id ?? null : null,
                  needsWorkingDays: needsDaysOf(d),
                  dueOn: d.dueAt,
                  givenToClient: d.givenToClient === true,
                }
              })}
              today={iraqDay(new Date())}
              goLiveOn={s.goLiveAt || null}
              // The go-live is asked for only where it does the work: without phases it fills the
              // blank dates (Edward, 29 Aug) and is optional — "quite often the client does not
              // want to confirm go live". With phases the season's own end dates do that job.
              onGoLiveChange={(s.phases.length > 0) ? null : onGoLiveChange}
              goLiveNote={
                dateNote ? (
                  <p className="muted" role="status" data-testid="wizard-golive-note">
                    {t('campaigns.wizard.datesFilled', { count: dateNote.filled })}
                    {dateNote.kept > 0 && ` ${t('campaigns.wizard.datesKept', { count: dateNote.kept })}`}
                  </p>
                ) : null
              }
              calendar={planningCalendar}
              rule={goLiveRule}
              renderCapacity={(p) => (
                <DepartmentWeekLoad
                  departmentId={p.departmentId}
                  departmentName={p.departmentName}
                  dueOn={p.dueOn}
                  testId={`wizard-timing-load-${p.id}`}
                />
              )}
              onSavePiece={(id, c) =>
                updateDeliverable(id, {
                  dueAt: c.dueOn,
                  // A date chooses the phase (Edward, 24 Sep) — earlier or later.
                  ...((s.phases.length > 0) ? { phaseNumber: s.phases.findIndex((x) => x.id === c.phaseId) + 1 || null } : { commenceAt: c.startsOn }),
                  givenToClient: c.givenToClient,
                  dueDateOverride: c.override,
                })
              }
              onPhasesChange={(list, moved) =>
                setS((prev) => ({
                  ...prev,
                  hasPhases: true,
                  phases: list.map((n) => ({ ...(prev.phases.find((x) => x.id === n.id) ?? blankPhase()), ...n, eventName: '' })),
                  deliverables: prev.deliverables.map((d) => {
                    const m = moved.find((x) => x.pieceId === d.id)
                    return m ? { ...d, phaseNumber: list.findIndex((x) => x.id === m.phaseId) + 1 || d.phaseNumber } : d
                  }),
                }))
              }
              testId="wizard-timing"
            />
          </div>
        )}

        {step === STEP.review && (
          <div className="sj-step" data-testid="wizard-step-5">
            {/* CB-v3-05. Grouped by workstream, with the facts strip and what approving actually
                does — rather than a second rendering of the whole brief. The brief is one press
                away from here, which is what "Edit any step" is for. */}
            <ReviewStepContainer
              campaignName={s.name}
              clientName={clients.find((c) => c.id === s.clientId)?.name ?? ''}
              brandName={brandLabel || null}
              briefSummary={s.proposition}
              approverName={accountManagers.find((u) => u.id === s.accountManagerId)?.name ?? ownerName(s.accountManagerId)}
              pieces={filledDeliverables.map((d) => ({
                id: d.id,
                workstreamId: d.workstreamId ?? null,
                language: d.language ?? null,
                dueAt: dueDateOf(d),
                departmentName: departmentLabel(pieceDepartmentId(d)),
                ownerName: d.ownerUserId ? ownerName(d.ownerUserId) : null,
              }))}
              grouping={s.hasWorkstreams}
              workstreams={s.workstreams.map((w) => ({
                id: w.id,
                name: w.name,
                departmentName: departmentName(w.departmentId),
                assignerName: groupOwnerName(w.ownerUserId),
              }))}
              phases={(s.phases.length > 0) ? s.phases : []}
              rules={s.rules.map((r) => ({ from: r.from }))}
              goLiveAt={s.goLiveAt || null}
              languageLabel={(code) => attrLabel('language', code) ?? code.toUpperCase()}
              campaignFolderName={campaignFolderRoot?.name ?? null}
              escalationHours={escalationHours}
              canApprove
              approving={submit.isPending || approve.isPending}
              onApprove={onSubmit}
              onSaveDraft={() => navigate('/campaigns')}
              onBack={back}
              onEditStep={() => setStep(STEP.brief)}
              testId="wizard-review"
            />
          </div>
        )}
      </div>

      <div className="sj-foot" data-testid="wizard-actions">
        {/* ADR-0067 d.6 retired the retry-or-continue branch that used to live here. It existed
            because the source document was filed AFTER submit and could fail on its own; now
            every document is filed into a real folder as it is chosen, so by the time this
            button is pressed there is no promise left outstanding. */}
        {step < TOTAL_STEPS && (
          <>
            <Button
              variant="primary"
              onClick={step === STEP.work ? keepAndGoToTiming : next}
              disabled={startDraft.isPending || updateDraft.isPending}
              data-testid="wizard-next"
            >
              {step === STEP.identity
                ? t('campaigns.wizard.nextToBrief')
                : step === STEP.brief
                  ? t('campaigns.wizard.nextToDeliverables')
                  : step === STEP.work
                    ? t('campaigns.wizard.keepTheseToTiming')
                    : step === STEP.timing
                      ? t('campaigns.wizard.nextToReview')
                      : t('campaigns.wizard.next')}
            </Button>
            {step > 1 && (
              <Button variant="secondary" onClick={back} data-testid="wizard-back">
                {t('campaigns.wizard.back')}
              </Button>
            )}
            <Button variant="secondary" className="wizard-cancel" onClick={() => navigate('/campaigns')} data-testid="wizard-cancel">
              {t('schedule.cancel')}
            </Button>
            <span className="sj-foot-note">{t(step === STEP.brief ? 'campaigns.wizard.footNoteBrief' : 'campaigns.wizard.footNote')}</span>
          </>
        )}
      </div>

      {(submit.isPending || approve.isPending) && (
        <BusyDialog text={t('campaigns.wizard.submitting')} testId="wizard-busy-submit" />
      )}
    </section>
  )

  function updateDeliverable(id: string, patch: Partial<DeliverableDraft>) {
    setS((prev) => ({
      ...prev,
      deliverables: prev.deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }))
    // Touching a proposed row is the person taking it on. The marker comes off at once.
    dispatch({ type: 'touchDeliverable', id })
  }
  /** Draft ids for rows nothing has been written for yet. Shared counter, so none can collide. */
  function nextDraftId(prefix: string): string {
    seq += 1
    return `${prefix}${seq}`
  }

  /**
   * One piece, saved from `CB-v3-P4`/`P8`.
   *
   * It carries the behaviour the old table's type picker held (ADR-0097 d.4), because the picker
   * moved into the dialog and the rule did not change: choosing a catalogue entry clears the
   * "needs a choice" flag, and the row takes the entry's NAME — but only where the name was not
   * the person's own words. A row somebody has named is never renamed underneath them.
   *
   * SEVERAL LANGUAGES IS SEVERAL PIECES (`I56.7`). The frame's own footnote says why — "Kurdish:
   * its own owner and status" — so a draft naming three languages saves three rows, each with one
   * language, rather than one row pretending to be three.
   */
  function savePiece(draft: PieceDraft, workstreamId: string | null) {
    const entry = draft.deliverableTypeId ? catalogue.items.find((x) => x.id === draft.deliverableTypeId) : undefined
    const phaseNumber = draft.phaseId ? Number(draft.phaseId) : null

    const shape = (base: DeliverableDraft, language: string | null): DeliverableDraft => {
      const previous = catalogue.items.find((x) => x.id === base.deliverableTypeId)?.name ?? null
      const named = draft.name.trim()
      // Three ways a name is not the person's own: it is blank, it is still the previous
      // entry's name, or the model could not place the row and named it from the brief's
      // own words (ADR-0097 d.2/d.4). Any of those follows the entry; a name somebody typed
      // never does.
      const follow =
        !named ||
        (previous != null && named === previous) ||
        Boolean(base.needsType && named === (base.note ?? '').trim())
      return {
        ...base,
        name: entry && follow ? entry.name : named,
        contentIdea: draft.idea,
        notes: draft.notes,
        deliverableTypeId: draft.deliverableTypeId,
        needsType: draft.deliverableTypeId ? false : base.needsType,
        format: draft.format,
        channel: draft.channel,
        priority: draft.priority,
        quantity: draft.quantity,
        ownerUserId: draft.ownerUserId ?? '',
        phaseNumber: (s.phases.length > 0) ? phaseNumber : null,
        workstreamId,
        language,
      }
    }

    const languages = draft.languages.length > 0 ? draft.languages : [null]

    setS((prev) => {
      const existing = pieceDialog?.mode === 'edit' ? prev.deliverables.find((d) => d.id === pieceDialog.id) : null
      // The first language keeps the row being edited, so its id, its dates and anything the
      // timing step has already decided survive. The rest are new rows beside it.
      const rows = languages.map((language, i) =>
        shape(i === 0 && existing ? existing : { ...blankDeliverable(), id: nextDraftId('d') }, language),
      )
      const head = rows[0]!
      const rest = rows.slice(1)
      return {
        ...prev,
        deliverables: existing
          ? [...prev.deliverables.map((d) => (d.id === existing.id ? head : d)), ...rest]
          : [...prev.deliverables, ...rows],
      }
    })
    // Editing a proposed row is the person taking it on (ADR-0048 d.4); the mark comes off here.
    if (pieceDialog?.mode === 'edit') dispatch({ type: 'touchDeliverable', id: pieceDialog.id })
  }


  function updatePhase(id: string, patch: Partial<PhaseDraft>) {
    setS((prev) => ({ ...prev, phases: prev.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }


  /** The dates as `CampaignPhasesPanel` prints them: "12 – 18 Sep", or the event's day alone. */
  function phaseDates(p: PhaseDraft): string {
    if (!p.startsOn && !p.endsOn) return ''
    return formatPlanRange(p.startsOn || p.endsOn, p.endsOn || p.startsOn, loc)
  }

  /**
   * Saving a phase from `CB-v3-P1`: a name, a start date and an end date. Editing clears any event
   * label an older draft carried — a phase is its dates now (Edward, 24 Sep).
   */
  function savePhase(v: { name: string; startsOn: string; endsOn: string }) {
    const dialog = phaseDialog
    setPhaseDialog(null)
    if (!dialog) return
    if (dialog.mode === 'edit') {
      updatePhase(dialog.id, { name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, eventName: '' })
      return
    }
    setS((prev) => ({
      ...prev,
      hasPhases: true,
      phases: [...prev.phases, { ...blankPhase(), name: v.name, startsOn: v.startsOn, endsOn: v.endsOn }],
    }))
  }
  function removePhase(id: string) {
    setS((prev) => {
      // ADR-0116 d.1: the last phase can go too (I65.3 — it was refused here in silence, the dialog offering it).
      const index = prev.phases.findIndex((p) => p.id === id)
      const phases = prev.phases.filter((p) => p.id !== id)
      // Rows in the removed phase lose it; rows after it move down one, as the numbers do.
      const deliverables = prev.deliverables.map((d) => {
        if (d.phaseNumber == null) return d
        if (d.phaseNumber === index + 1) return { ...d, phaseNumber: null }
        if (d.phaseNumber > index + 1) return { ...d, phaseNumber: d.phaseNumber - 1 }
        return d
      })
      return { ...prev, phases, deliverables }
    })
  }
  function phaseOf(n: number | null | undefined): { name: string; endsOn: string; startsOn: string } | null {
    if (!(s.phases.length > 0) || n == null) return null
    const p = s.phases[n - 1]
    return p ? { name: p.name || `${n}`, startsOn: p.startsOn, endsOn: p.endsOn } : null
  }
  function phaseLabel(n: number | null | undefined): string {
    const p = phaseOf(n)
    return p && n != null ? `${n}. ${p.name}` : t('campaigns.wizard.noPhase')
  }
  /** ADR-0096 d.8's fallback: a row the model did not place goes to the ONE phase whose dates hold
   *  its due day; with overlap, or no match, it stays unplaced and flagged for the person. */
}
