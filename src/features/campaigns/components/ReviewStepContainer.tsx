import { useTranslation } from 'react-i18next'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { ReviewStepV3, type ReviewFacts, type ReviewWorkstream } from './ReviewStepV3'

/**
 * **The wizard's step 5, wired** (`I56.12`, Figma `CB-v3-05`).
 *
 * `ReviewStepV3` is a frame: it prints what it is handed and presses buttons. This is the piece
 * between it and `BriefWizard`'s state — it takes the campaign as the wizard actually holds it
 * (pieces, workstreams, phases, rules) and works out the five facts, the workstream rows and the
 * library path from those rows themselves.
 *
 * **Why the facts are derived here and not passed in.** The frame's strip says "99 pieces" and its
 * table says 21 + 8 + 40. If the strip took a number and the table took a list, the two would
 * disagree the first time a row was added in one place and counted in another — which is the
 * failure `AGENTS.md` §5 calls "derive, don't ask", and the failure this codebase has already had
 * (the audit-trigger list of 22 tables). So there is ONE list of pieces, everything on the screen
 * is counted off it, and the strip and the table cannot drift apart.
 *
 * **Ungrouped work (ADR-0099 d.1) is a row, not a footnote.** A piece may belong to no workstream,
 * for ever, and that is not a half-finished state to nag about. Every loose piece is gathered into
 * one final row titled with the existing `workstreams.ungrouped` string — *"Not in a workstream"* —
 * carrying its own count and no assigner, which the frame already words as "nobody assigns it yet".
 * A piece pointing at a workstream that is no longer in the list lands there too, rather than
 * vanishing from a count nobody is checking. The consequence: `sum(rows) === facts.pieces`, always,
 * and a campaign with no workstreams at all still shows its work instead of an empty table (the
 * narrowed list falling back to the full one — Edward, and the UI never blocks).
 *
 * One thing the frame cannot express, and the caller should know: the loose row travels in the
 * same list as the real workstreams, so `ReviewStepV3`'s chip and lede count it as one — a
 * campaign with three workstreams and some loose work reads "4 workstreams". Making it read
 * truthfully needs a flag on `ReviewWorkstream` (`isCatchAll`) that the frame excludes from its
 * own counts, which is a change to a file this task does not own.
 *
 * **What it deliberately does not do.** It runs no query and holds no state: `canApprove`,
 * `approving` and the four callbacks come from the wizard, which owns `useApproveCampaign` and the
 * ADR-0083 d.14 reading of who may sign. Nothing here decides authority — the database does
 * (`AGENTS.md` §2), and this only makes sure the refusal names the person who can.
 */

/** One piece, as the wizard holds it on the work step. Count, language and finale come from these. */
export interface ReviewPiece {
  id: string
  /** ADR-0099 d.1: null is legal and permanent. An unknown id is treated as null, not dropped. */
  workstreamId: string | null
  /** I56.7: the ONE language it ships in — a tenant attribute code (`ar`, `en`, `ku`). */
  language: string | null
  /** `YYYY-MM-DD`. The campaign's finale falls back to the last of these when there are no phases. */
  dueAt: string | null
  /** The department its owner belongs to (ADR-0050 d.2). Read only to label the loose-work row. */
  departmentName: string | null
  /** Who owns it — the person told on approval, who then approves its task list (ADR-0100 d.2). */
  ownerName?: string | null
}

/** A workstream as the wizard holds it, with its names already resolved. Its SIZE is not asked for. */
export interface ReviewWorkstreamInput {
  id: string
  name: string
  departmentName: string
  /** ADR-0099 d.5: the lead who assigns inside it. Null until somebody is named. */
  assignerName: string | null
  /** `1`–`12`. Left out, the frame derives a stable one from the id. */
  hue?: number
}

/** A phase, as ADR-0096 d.2 / I56.10 hold one. `startsOn` is empty on the first phase of a season. */
export interface ReviewPhaseInput {
  startsOn: string | null
  endsOn: string | null
}

/** A do or a don't from the brief step. Only its origin matters here — the strip counts, not quotes. */
export interface ReviewRuleInput {
  from: 'client' | 'campaign'
}

/** The row every loose piece is gathered into. Fixed, so its colour and its test id never move. */
const UNGROUPED_ROW_ID = 'ungrouped'

/** The campaign's languages, as the frame prints them: `AR · EN · KU`. */
const LANGUAGE_SEPARATOR = ' · '

/**
 * The library path, joined the way the Library's own breadcrumb joins one (`FolderPicker`). A
 * slash rather than the frame's arrow on purpose: this string is read in Arabic too, and an arrow
 * points the wrong way the moment the paragraph around it flips.
 */
const PATH_SEPARATOR = ' / '

/** The earliest / latest of a set of `YYYY-MM-DD` days, ignoring the empty ones. ISO sorts. */
function earliest(days: readonly (string | null | undefined)[]): string | null {
  const real = days.filter((d): d is string => Boolean(d && d.trim()))
  return real.length > 0 ? real.reduce((a, b) => (b < a ? b : a)) : null
}

function latest(days: readonly (string | null | undefined)[]): string | null {
  const real = days.filter((d): d is string => Boolean(d && d.trim()))
  return real.length > 0 ? real.reduce((a, b) => (b > a ? b : a)) : null
}

export interface ReviewStepContainerProps {
  campaignName: string
  clientName: string
  brandName: string | null
  /** The proposition, in the account manager's own words. Blank falls back to a line saying so. */
  briefSummary: string
  /** The account manager who approves (ADR-0083 d.14). Step 1 refuses to pass without one. */
  approverName: string
  /** Every piece on the campaign — the ONE list the strip and the table are both counted off. */
  pieces: readonly ReviewPiece[]
  workstreams: readonly ReviewWorkstreamInput[]
  /** ADR-0101 d.9: false when the campaign does not use workstreams — "Who gets what" lists owners. */
  grouping?: boolean
  /** `[]` when the campaign does not run in phases (ADR-0096 d.1) — then no chip is drawn. */
  phases: readonly ReviewPhaseInput[]
  /** The brief's dos and don'ts. Absent or empty leaves the Rules fact blank rather than "0". */
  rules?: readonly ReviewRuleInput[]
  /** `YYYY-MM-DD`. The campaign's own go-live; the first thing the Launch fact asks. */
  goLiveAt: string | null
  /** A language code as the tenant names it. Left out, the code is shown upper-cased. */
  languageLabel?: (code: string) => string
  /** `useCampaignFolderRoot(draftId).data?.name` — the campaign's real folder (ADR-0022). */
  campaignFolderName?: string | null
  /** ADR-0045 d.3 — `useReminderSettings().data.assignmentEscalationHours`, not a constant here. */
  escalationHours: number
  /** The caller's reading of ADR-0083 d.14. False keeps the button and names who can. */
  canApprove: boolean
  approving?: boolean
  onApprove: () => void
  onSaveDraft: () => void
  onBack: () => void
  onEditStep: () => void
  testId?: string
}

export function ReviewStepContainer({
  campaignName,
  clientName,
  brandName,
  briefSummary,
  approverName,
  pieces,
  workstreams,
  grouping = true,
  phases,
  rules = [],
  goLiveAt,
  languageLabel,
  campaignFolderName,
  escalationHours,
  canApprove,
  approving = false,
  onApprove,
  onSaveDraft,
  onBack,
  onEditStep,
  testId = 'approve',
}: ReviewStepContainerProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'

  // A piece belongs to a workstream only if that workstream is still on the list. One that points
  // at a removed group is loose work, not lost work — dropping it is how a count starts lying.
  const known = new Set(workstreams.map((w) => w.id))
  const holds = (w: ReviewWorkstreamInput) => pieces.filter((p) => p.workstreamId === w.id).length
  const loose = pieces.filter((p) => p.workstreamId == null || !known.has(p.workstreamId))

  // The loose row's department: the one they share, or the plain fact that they do not share one.
  // (Every piece has an owner by the time this screen renders, so "no department at all" is only
  // reachable from a caller that does not pass one, and is left blank rather than guessed.)
  const looseDepartments = [...new Set(loose.map((p) => p.departmentName).filter(Boolean))]
  const looseDepartmentName =
    looseDepartments.length === 1 ? looseDepartments[0]! : looseDepartments.length > 1 ? t('approve.severalDepartments') : ''

  // Without workstreams the question "who gets what" is answered by the owners themselves: one row
  // per person, with what they will be asked to do. Grouping by a workstream that does not exist
  // would put every piece in one "Not in a workstream" row and name nobody.
  const owners = [...new Set(pieces.map((p) => p.ownerName?.trim()).filter((n): n is string => Boolean(n)))]
  const ownerRows: ReviewWorkstream[] = owners.map((name) => {
    const mine = pieces.filter((p) => p.ownerName?.trim() === name)
    const depts = [...new Set(mine.map((p) => p.departmentName).filter(Boolean))]
    return {
      id: `owner-${name}`,
      name,
      departmentName: depts.length === 1 ? depts[0]! : depts.length > 1 ? t('approve.severalDepartments') : '',
      pieceCount: mine.length,
      assignerName: null,
      tail: t('approve.approvesTaskLists'),
    }
  })
  const unowned = pieces.filter((p) => !p.ownerName?.trim()).length

  const groupRows: ReviewWorkstream[] = [
    ...workstreams.map((w) => ({
      id: w.id,
      name: w.name,
      departmentName: w.departmentName,
      pieceCount: holds(w),
      assignerName: w.assignerName,
      ...(w.hue != null ? { hue: w.hue } : {}),
    })),
    ...(loose.length > 0
      ? [
          {
            id: UNGROUPED_ROW_ID,
            name: t('workstreams.ungrouped'),
            departmentName: looseDepartmentName,
            pieceCount: loose.length,
            // Nobody assigns work that is in nobody's group — the frame says exactly that.
            assignerName: null,
          },
        ]
      : []),
  ]

  const rows: ReviewWorkstream[] = grouping
    ? groupRows
    : [
        ...ownerRows,
        ...(unowned > 0
          ? [{ id: 'no-owner', name: t('approve.noOwner'), departmentName: '', pieceCount: unowned, assignerName: null, tail: '' }]
          : []),
      ]

  const day = (iso: string | null) => (iso ? formatPlanDay(iso, loc) : null)

  /**
   * Launch is a DECISION and finale is a CONSEQUENCE, so they are not derived the same way.
   * Launch is the go-live if there is one, else the day the first phase opens — and nothing else,
   * because the earliest due date is when work starts, not when the campaign does, and printing
   * one as the other would be a confident wrong answer. Finale is the last phase's event, and
   * without phases the last thing that lands, which genuinely is when the campaign is over.
   */
  const launchDay = goLiveAt?.trim() || earliest(phases.map((p) => p.startsOn))
  // Without phases the go-live IS the launch and every piece is due before it, so the last due
  // date alone read as a finale BEFORE the launch (24 Sep: launch Thu 22 Oct, finale Tue 20 Oct).
  // The season cannot end before it starts: the finale is the latest of the go-live and the dates.
  const finaleDay = latest(phases.map((p) => p.endsOn)) ?? latest([goLiveAt, ...pieces.map((p) => p.dueAt)])

  const label = (code: string) => languageLabel?.(code) ?? code.toLocaleUpperCase()
  const languages = [...new Set(pieces.map((p) => p.language).filter((c): c is string => Boolean(c)))].sort()

  // "7 + client": the campaign's own rules, and whether the client's sit underneath (ADR-0098).
  const clientRules = rules.filter((r) => r.from === 'client').length
  const ownRules = rules.length - clientRules
  const rulesFact =
    rules.length === 0
      ? null
      : clientRules === 0
        ? String(ownRules)
        : ownRules === 0
          ? t('approve.rulesClientOnly')
          : t('approve.rulesPlusClient', { rules: ownRules })

  const facts: ReviewFacts = {
    pieces: pieces.length,
    launch: day(launchDay),
    finale: day(finaleDay),
    languages: languages.length > 0 ? languages.map(label).join(LANGUAGE_SEPARATOR) : null,
    rules: rulesFact,
  }

  // Where approving files the folders (ADR-0022). The campaign's own folder is provisioned with
  // the campaign, so its real name is used when the caller has read it; before that the campaign's
  // name is what the folder will be called anyway.
  const libraryPath = [clientName, brandName, campaignFolderName?.trim() || campaignName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(PATH_SEPARATOR)

  return (
    <ReviewStepV3
      campaignName={campaignName}
      clientName={clientName}
      brandName={brandName}
      briefSummary={briefSummary.trim() || t('approve.noSummary')}
      facts={facts}
      phaseCount={phases.length}
      workstreams={rows}
      grouping={grouping}
      ownerCount={owners.length}
      approver={{
        name: approverName.trim() || t('approve.noApprover'),
        roleLine: t('approve.roleLine', { client: clientName }),
      }}
      libraryPath={libraryPath}
      escalationHours={escalationHours}
      canApprove={canApprove}
      approving={approving}
      onApprove={onApprove}
      onSaveDraft={onSaveDraft}
      onBack={onBack}
      onEditStep={onEditStep}
      testId={testId}
    />
  )
}
