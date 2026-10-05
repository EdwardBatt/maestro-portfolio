import { BusyDialog, NoticeDialog } from '../../components/Notice'
import { useEffect, useState } from 'react'
import { InfoTip } from '../../components/InfoTip'
import { formatIraqDate, formatIraqShortDate, iraqDay } from '../../lib/time/iraq'
import { Trans, useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { BackButton } from '../../components/BackButton'
import { PiecePanel } from './components/PiecePanel'
import { DeliverableDialog } from './components/DeliverableDialog'
import { PromoteDialog } from './components/PromoteDialog'
import { usePromoteSingleJob } from '../intake/api/intake-api'
import { useClientCalendar } from '../../lib/calendar/client-calendar'
import { Button, IconButton } from '../../components/Button'
import { useAccountManagers } from '../clients/api/clients-api'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import { failed, type Banner } from '../deliverables/DeliverablesPage'
import { fillerRefusalMessage } from '../../lib/brief/filler-refusal'
import { useCampaignDeliverables } from '../deliverables/api/deliverables-api'
import { CampaignGrid } from './components/CampaignGrid'
import { PieceDrawer } from './components/PieceDrawer'
import { ReopenDialog } from '../deliverables/components/ReopenDialog'
import { reopenDoneText } from '../deliverables/lib/reopen-text'
import { amendmentsOf, useAmendmentSummary } from '../../lib/amendments/amendment-summary'
import { useReopenableDeliverables } from '../deliverables/api/reopen-api'
import { useReopenCampaign } from './api/campaign-api'
import { BriefView } from './components/BriefView'
import { SeasonMap } from './components/SeasonMap'
import { CampaignBoard } from './components/CampaignBoard'
import { CampaignTimeline } from './components/CampaignTimeline'
import { WhereIsEverything } from './components/WhereIsEverything'
import { EditPieceDialog } from './components/EditPieceDialog'
import { RenameCampaignDialog } from './components/RenameCampaignDialog'
import { useCampaignChangeRequests } from './api/change-requests-api'
import { useOutstandingInputs } from './api/outstanding-inputs-api'
import { useCampaignRisk } from './api/campaign-risk-api'
import {
  useApproveCampaign,
  useSetCampaignAccountManager,
  useBriefTemplateFields,
  useCampaignDetail,
  useCampaignPhases,
  useSetCampaignPhases,
  type CampaignPhase,
} from './api/campaign-detail-api'
import { PhasesDialog } from './components/PhasesDialog'

/**
 * The campaign's six views, in the frames' order (CG-01…CG-07, I57.4): Brief · Where is everything ·
 * Grid · Season map · Board · Timeline. The Season map is a campaign's with phases only (Edward: "for
 * campaigns with phases") — its tab is not offered without them, rather than opening onto nothing.
 */
const VIEWS = ['brief', 'where', 'grid', 'seasonMap', 'board', 'timeline'] as const
type View = (typeof VIEWS)[number]

/** Stable empties, so a read that has not answered does not re-render every view. */
const NO_INPUTS: ReadonlyMap<string, number> = new Map()
const NO_RISK: NonNullable<ReturnType<typeof useCampaignRisk>['data']> = new Map()

/** The brief lines a piece is made from, as CG-04 sets them under "The brief". */
const DRAWER_BRIEF_KEYS = ['task', 'proposition', 'insight'] as const

/** A link may still name an old tab: the campaign brief was `campaign`, every piece was `all`,
 *  and a department's own tab was its id (My Work's "Write Creative's brief", I53.22). The brief
 *  opens on Brief; everything else opens on the Grid, where that work now is. */
function viewOf(tab: string | null): View {
  if (tab === 'campaign') return 'brief'
  return (VIEWS as readonly string[]).includes(tab ?? '') ? (tab as View) : 'grid'
}import { WorkstreamsPanel } from './components/WorkstreamsPanel'
import { useWorkstreams } from './api/workstreams-api'
import { useDepartments } from '../admin/api/admin-api'
import { useDeliverableOwnerCandidates } from '../deliverables/api/deliverables-api'
import { useCampaignExtensionRequests, type ExtensionEvent } from '../deliverables/api/extensions-api'

/**
 * One campaign, whole (ADR-0048 d.9, I16.6, as corrected by ADR-0050).
 *
 * This is the page Edward asked for on 27 Aug: "each brief is the UI displaying all campaign
 * related information and where tasks can be edited for each deliverable". Before it, a
 * campaign had no page — `/deliverables` showed a filtered list of its deliverables and nothing
 * about the campaign itself, so the brief the work came from lived somewhere else entirely.
 *
 * It is also the approval surface. Those are the same screen on purpose: approving a campaign
 * means reading it, and a reviewer who has to open three places to do that will approve without
 * reading. **There is no changes-requested action** (d.9) — the account manager edits in place
 * and approves, because the person who can approve is the person correcting it.
 *
 * Sub-tasks are defined and assigned through the SAME `DeliverableDetail` the deliverables
 * surface uses, imported rather than reimplemented. Two copies of "assign a task" is how the
 * reviewer-on-the-deliverable bug happened.
 *
 * **Sections are per DEPARTMENT, from the deliverables AND the briefs together** — see
 * `departmentSections`. Each source is partial in its own direction: nothing writes
 * `campaign_briefs` yet (`generate-brief` is built but unwired, I16.4), and deliverables can exist
 * before, after, or without a brief. A department with work and no brief says so; a department
 * with a brief and no work yet still shows its brief, which is the whole point of the screen.
 *
 * **Nothing here fails silently.** A failed read renders as a failed read — never as "no work yet"
 * and never as "not found". That confusion is the 27 Aug outage in one line: `useCampaignDetail`
 * threw on a dead column, `campaign.data` was undefined, and the page said the campaign did not
 * exist for a day while the real answer, PostgREST's 42703, was on the floor.
 */
export function CampaignPage() {
  const { t } = useTranslation()
  const { campaignId = '' } = useParams()
  const { can, scope } = usePermissions()
  const { session } = useAuth()
  const campaign = useCampaignDetail(campaignId || null)
  const deliverables = useCampaignDeliverables(campaignId || null)
  // ADR-0110 (I59.23): the newest change request on each piece — the drawer and the Board card say it.
  const changeRequests = useCampaignChangeRequests((deliverables.data ?? []).map((d) => d.id))
  // ADR-0099 / I56.3. All three are tolerant of empty: grouping is optional, so a campaign with no
  // workstreams is a normal campaign and not a page in a failed state.
  const workstreams = useWorkstreams(campaignId || null)
  const departmentList = useDepartments().data ?? []
  // ADR-0115: the workstream department picker offers only departments that take production work.
  const workDepartmentList = departmentList.filter((d) => d.isProduction !== false)
  const ownerCandidates = useDeliverableOwnerCandidates().data ?? []
  const approve = useApproveCampaign()
  // I52.17 — hooks live above the page's early returns, like every other one here.
  const setManager = useSetCampaignAccountManager()
  const managers = useAccountManagers()
  const [choosingManager, setChoosingManager] = useState(false)
  const [managerChoice, setManagerChoice] = useState<string>('')
  const [banner, setBanner] = useState<Banner | null>(null)
  // ADR-0088 d.10: the pending extension requests under this campaign, against each deliverable;
  // and d.7a, the one route by which a deliverable's promised date changes.
  const extensionRequests = useCampaignExtensionRequests(campaignId || null)
  // ADR-0096: the campaign's phases (empty when off), the toggle, the move, the dialog and the
  // filter every department table shares.
  const phases = useCampaignPhases(campaignId || null)
  const setPhases = useSetCampaignPhases()
  const [phasesOpen, setPhasesOpen] = useState(false)
  // CG-04 (I57.16): the piece drawer, opened from every view — one piece at a time. ADR-0132 d.6: a link may open
  // it (`?piece=<deliverable>&task=<task>`) — from a task on the Team page, the Schedule, a dashboard or a
  // notification — with the task the person came from marked. Switching tabs keeps it open on the same piece.
  const [searchParams, setSearchParams] = useSearchParams()
  const [openPieceId, setOpenPieceIdState] = useState<string | null>(() => searchParams.get('piece'))
  const markTaskId = searchParams.get('task')
  const setOpenPieceId = (id: string | null) => {
    setOpenPieceIdState(id)
    // Closing removes the link's own params, so a reload does not reopen what was closed.
    if (id == null && (searchParams.has('piece') || searchParams.has('task'))) {
      const next = new URLSearchParams(searchParams)
      next.delete('piece')
      next.delete('task')
      setSearchParams(next, { replace: true })
    }
  }
  // ADR-0132 d.1: "+ Add a deliverable" and "Promote to a campaign" on the header.
  const [addingPiece, setAddingPiece] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const promote = usePromoteSingleJob()
  // CG-E1 (I57.11): the piece's Edit, opened from the drawer and from every view but the Grid (which
  // opens its own).
  const [editPieceId, setEditPieceId] = useState<string | null>(null)
  // ADR-0103: re-opening a finished piece by the tasks that need doing again; a closed campaign.
  const [reopenPieceId, setReopenPieceId] = useState<string | null>(null)
  const reopenable = useReopenableDeliverables(campaignId || null)
  // ADR-0142 d.3 (I74.20): client amendments — each piece's count (all time), and the campaign's for this month.
  const amendAll = useAmendmentSummary(null)
  const amendMonth = useAmendmentSummary(iraqDay(Date.now()))
  const reopenCampaign = useReopenCampaign()
  // The Board, Timeline and Where-is-everything read what a piece is waiting on, and the clock.
  const outstandingInputs = useOutstandingInputs(campaignId || null)
  const risk = useCampaignRisk(campaignId || null)
  /**
   * Which tab is open. Edward, 6 Sep: *"we spent a lot of time changing the layout wizard to
   * display campaigns in tabs, campaign brief, dept briefs and deliverables, when i open the
   * campaign by ID this layout is gone."* Step 5 of the wizard reviews a campaign in tabs and this
   * page reviewed the same campaign as one long scroll — the same document, read two ways.
   *
   * `campaign` and `all` are reserved; every other value is a department's section key, so a tab
   * that disappears (a department loses its last deliverable) falls back rather than blanking the
   * page. Not written back to the URL: the tab is where you are in a document, not which document
   * — but a link may OPEN the page on a department's tab (`?tab=<department id>`), which is how
   * "Write Creative's brief" on My Work lands on the Generate button (I53.22, 21 Sep).
   */
  const [tab, setTab] = useState<View>(() => viewOf(searchParams.get('tab')))
  // I59 Track 11: a link may open a piece's Edit (`?edit=<deliverable id>`) — Needs you's "Send a
  // new request" after a declined change (Track 6) lands here, where the new request is made
  // (Track 10). Offered to the same people the views' Edit is; an id not on this campaign opens
  // nothing (`editPiece` below finds no piece).
  const editParam = searchParams.get('edit')
  const mayEditPieces = can('project_tasks:manage')
  useEffect(() => {
    // ADR-0132 d.2: the piece's panel is the editor now — `?edit=` opens it.
    if (editParam && mayEditPieces) setOpenPieceIdState(editParam)
  }, [editParam, mayEditPieces])

  const c = campaign.data
  // ADR-0123 d.3: the timeline's working days are the client's.
  const { calendar: clientCalendar } = useClientCalendar(c?.clientId ?? null)
  const templates = useBriefTemplateFields(
    (c?.briefs ?? []).map((b) => b.briefType).filter(Boolean) as string[],
  )

  // The deliverables decide what sections exist, so the page is not finished loading until they
  // have arrived — otherwise a campaign with work flashes "nothing here yet" on the way in.
  if (campaign.isLoading || deliverables.isLoading)
    return <p className="muted">{t('campaigns.page.loading')}</p>

  // The campaign itself failed to load: there is no page to render, and — the 27 Aug lesson — a
  // failed read is NOT a missing campaign. Say which it was, and show what the server said.
  if (campaign.isError)
    return (
      <p className="form-error" role="alert" data-testid="campaign-load-failed">
        {t('campaigns.page.loadFailed')}{' '}
        <span data-testid="campaign-load-failed-reason">{failureText(campaign.error)}</span>
      </p>
    )
  if (!c) return <p className="form-error">{t('campaigns.page.notFound')}</p>



  // Approved is what turns unassigned work from 'not started yet' into 'should have started'.
  const isApproved = c.status === 'approved'
  // The SAME rule `app.approve_campaign` uses: coalesce(campaign, client). Reading only the
  // campaign's made the button unreachable on every wizard-created campaign, because
  // `create_campaign_from_brief` never set one.
  const approverId = c.accountManagerId ?? c.clientAccountManagerId
  // The NAME that goes with that id, resolved the same way round. "The account manager" is not an
  // answer to "who do I chase?" — the page had the id all along and never showed anybody.
  const approverName = c.accountManagerId ? c.accountManagerName : c.clientAccountManagerName
  const isAccountManager = approverId != null && approverId === session?.user?.id
  // I52.16 (Edward, 17 Sep: as Power Admin he could not approve a campaign — "this was a backup
  // that was required"). The database admits anyone with projects:manage whose reach covers the
  // account manager (ADR-0083 addendum d.14): the named AM, and the tenant-wide and all-accounts
  // roles — Power Admin, Traffic, Account Director. The screen offered the button to the AM alone,
  // stricter than the rule it fronts. Now it offers it to everyone the rule admits and lets the
  // database word the refusal for anybody else (ADR-0092).
  const wideReach = can('projects:manage') && (scope === 'tenant' || scope === 'all_accounts')
  const mayApprove = isAccountManager || wideReach
  // I52.17: the same people may say WHO the manager is, so a row naming the wrong person can be
  // corrected here instead of being stuck (the wizard writes it once; nothing touched it after).
  const mayChangeManager = isAccountManager || wideReach
  const noApproverAtAll = approverId == null
  const pending = c.status === 'pending_approval'

  const openTab = tab
  const openPiece = openPieceId ? (deliverables.data ?? []).find((d) => d.id === openPieceId) ?? null : null
  const allDeliverables = deliverables.data ?? []
  const livePieces = allDeliverables.filter((d) => d.state !== 'archived')
  const todayIraq = iraqDay(Date.now())
  const deliveredCount = livePieces.filter((d) => d.state === 'delivered').length
  const currentPhase = (c.hasPhases ? (phases.data ?? []) : []).find((p) => p.startsOn <= todayIraq && todayIraq <= p.endsOn) ?? null
  // Pending requests grouped by deliverable, for the line against each row.
  const pendingByDeliverable = new Map<string, ExtensionEvent[]>()
  for (const r of extensionRequests.data ?? []) {
    pendingByDeliverable.set(r.deliverableId, [...(pendingByDeliverable.get(r.deliverableId) ?? []), r])
  }
  // d.7a: the promise changes "via the AM for now". Shown to the account manager and to anyone
  // holding projects:manage — the server decides by scope, and a control wrongly absent is worse
  // than one the server refuses (the BriefApproval reasoning). Only once the campaign is approved:
  // before that the dates are still being written in the wizard.
  const canChangePromise = isApproved && (isAccountManager || can('projects:manage'))
  // ADR-0096 d.4: phases are the campaign's shape — the approval authority's, like adding work.
  const mayShapePhases = mayApprove && c.status !== 'closed' && c.kind !== 'single_job'
  const phaseList: readonly CampaignPhase[] = c.hasPhases ? (phases.data ?? []) : []
  const countByPhase = new Map<string, number>()
  for (const d of allDeliverables) {
    if (d.phaseId) countByPhase.set(d.phaseId, (countByPhase.get(d.phaseId) ?? 0) + 1)
  }
  // The views' Edit: anyone who manages the work. ADR-0132 d.2: it opens the piece's panel, the one editor.
  const onEditPiece = can('project_tasks:manage') ? (id: string) => setOpenPieceId(id) : null
  const isSingleJob = c.kind === 'single_job'
  const mayAddPiece = mayApprove && c.status !== 'closed'
  const mayPromote = isSingleJob && can('projects:manage') && c.status !== 'closed'
  // ADR-0132 d.5: a single job has the same six tabs; one greys out when it would be empty, and says why.
  const datedPieces = livePieces.some((d) => d.dueAt)
  const offReason = (v: View): string | null => {
    if (!isSingleJob) return null
    if ((v === 'seasonMap' || v === 'timeline') && !datedPieces) return t('campaigns.tabs.offUndated')
    if ((v === 'board' || v === 'where') && livePieces.length <= 1) return t('campaigns.tabs.offOnePiece')
    return null
  }
  const editPiece = editPieceId ? allDeliverables.find((d) => d.id === editPieceId) ?? null : null
  const inputsMap = outstandingInputs.data ?? NO_INPUTS
  const riskMap = risk.data ?? NO_RISK
  // ADR-0075, the campaigns list's own test: late or at risk.
  const atRiskCount = [...riskMap.values()].filter((r) => r.assessment.level === 'late' || r.assessment.level === 'at_risk').length
  // I63.5 (Edward, 28 Sep): the Season map is on every campaign — by phase, or by week without phases.
  const shownTab: View = offReason(openTab) ? 'grid' : openTab
  const views = VIEWS

  return (
    <section className="page cg-page" data-testid="surface-campaign">
      {/* ADR-0092 d.1 / I48.8: a model call per department, and the approval that releases work. */}
      {approve.isPending && <BusyDialog text={t('campaigns.busy.approving')} testId="campaign-busy" />}
      {/* CG-01's header (I63.1): the title, the chips — client · brand, where the campaign is — and one line.
          Edward, 28 Sep (A): the account manager is the line's "… approves", changed with the pencil after the
          name; who started it and who last changed it (I51.1) sit in the (i) beside the title. */}
      <BackButton testId="campaign-back" />
      <header className="page-head cg-head">
        <div className="cg-head-actions" data-testid="campaign-head-actions">
          {/* Offered to whoever may edit the brief — the Brief tab's own rule (its `mayEdit` / `mayEditJobBrief`: the
              approval authority, not closed). A team member reads the brief and is offered no Edit (spec "may NOT"). */}
          {mayApprove && c.status !== 'closed' && (
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setTab('brief')} data-testid="campaign-edit-brief">
              {t('campaigns.page.editBrief')}
            </Button>
          )}
          {mayPromote && (
            <Button variant="secondary" size="sm" onClick={() => setPromoting(true)} data-testid="campaign-promote-job">
              {t('intake.promote.action')}
            </Button>
          )}
          {mayAddPiece && (
            <Button variant="primary" size="sm" icon="plus" onClick={() => setAddingPiece(true)} data-testid="campaign-add-deliverable">
              {t('campaigns.page.addDeliverable')}
            </Button>
          )}
        </div>
        {renaming && <RenameCampaignDialog campaignId={c.id} name={c.name} isJob={c.kind === 'single_job'} onClose={() => setRenaming(false)} />}
        <h1 className="cg-title">
          <span>{c.name}</span>
          {/* ADR-0137: the approval authority renames a live campaign or job; a draft's name is the wizard's. */}
          {mayApprove && c.status !== 'closed' && c.status !== 'draft' && (
            <IconButton icon="edit" size="sm" label={t('campaigns.rename.action')} onClick={() => setRenaming(true)} data-testid="campaign-rename-open" />
          )}
          <InfoTip
            label={t('campaigns.page.provenanceLabel')}
            lines={[
              `${t('provenance.createdBy', { name: c.createdByName ?? t('provenance.notRecorded') })}${c.createdAt ? ` · ${formatIraqDate(c.createdAt)}` : ''}`,
              ...(c.updatedByName ? [`${t('provenance.editedBy', { name: c.updatedByName })}${c.updatedAt ? ` · ${formatIraqDate(c.updatedAt)}` : ''}`] : []),
            ]}
            testId="campaign-provenance"
          />
        </h1>
        <div className="cg-meta" data-testid="campaign-summary">
          <span className="cg-chip is-client" data-testid="campaign-client-chip">
            {[c.clientName, c.brandName].filter(Boolean).join(' · ')}
          </span>
          {c.status !== 'approved' && (
            <span className={`cg-chip${c.status === 'pending_approval' ? ' is-now' : ''}`} data-testid="campaign-status-chip">
              {t(`campaigns.status.${c.status}`)}
            </span>
          )}
          {currentPhase && (
            <span className="cg-chip is-now" data-testid="campaign-summary-phase">
              {t('campaigns.phaseNow', { name: currentPhase.name, number: currentPhase.number, of: phaseList.length })}
            </span>
          )}
          {c.goLiveAt && (
            <span className="cg-chip" data-testid="campaign-golive-chip">{t('campaigns.page.goLiveChip', { day: formatIraqShortDate(c.goLiveAt) })}</span>
          )}
          <span className="cg-line">
            <span>
            {[
              t('campaigns.summary', { count: livePieces.length }),
              t('campaigns.page.deliveredCount', { count: deliveredCount }),
              atRiskCount > 0 ? t('campaigns.page.atRiskCount', { count: atRiskCount }) : null,
              (() => {
                const a = amendmentsOf(amendMonth.data, 'campaign', c.id)
                return a ? t('amendments.monthLine', { count: a.amendments, hours: a.hours }) : null
              })(),
            ].filter(Boolean).join(' · ')}
            {' · '}
            </span>
          <span className="cg-am" data-testid="campaign-account-manager">
          {choosingManager ? (
            <span className="inline-edit">
              <select
                value={managerChoice}
                onChange={(e) => setManagerChoice(e.target.value)}
                aria-label={t('campaigns.page.changeAccountManager')}
                data-testid="campaign-account-manager-select"
              >
                <option value="">{t('campaigns.page.amUseClients')}</option>
                {(managers.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <IconButton
                icon="check" size="sm" label={t('common.save')} disabled={setManager.isPending}
                onClick={() =>
                  setManager.mutate({ campaignId: c.id, userId: managerChoice || null }, {
                    onSuccess: () => { setChoosingManager(false); setBanner({ kind: 'ok', text: t('campaigns.page.accountManagerChanged') }) },
                    onError: (e) => { setChoosingManager(false); setBanner(failed(e, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)) },
                  })
                }
                data-testid="campaign-account-manager-save"
              />
              <IconButton icon="close" size="sm" label={t('common.cancel')} onClick={() => setChoosingManager(false)} data-testid="campaign-account-manager-cancel" />
            </span>
          ) : (
            <>
              {approverName ? (
                <span><Trans i18nKey="campaigns.page.approves" values={{ name: approverName }} components={{ n: <span data-testid="campaign-account-manager-name" /> }} /></span>
              ) : (
                <span className="cell-warn">{t('campaigns.page.amUnassigned')}</span>
              )}
              {mayChangeManager && c.status !== 'closed' && (
                <IconButton
                  icon="edit" size="sm"
                  label={t('campaigns.page.changeAccountManager')}
                  onClick={() => { setManagerChoice(c.accountManagerId ?? ''); setChoosingManager(true) }}
                  data-testid="campaign-account-manager-change"
                />
              )}
            </>
          )}
          </span>
          </span>
        </div>
      </header>

      {/* D/E (I48): a single job's work lives on its deliverable — the task list, the owner's
          Approve, and reassigning to a team lead are all there, not on this overview. Send the
          owner straight to it rather than leaving them on a campaign page that cannot do it. Only
          while there is ONE: a job with several (I54.33) lists each under "Task lists to approve". */}
      {addingPiece && (
        <DeliverableDialog
          campaignId={c.id}
          goLiveAt={c.goLiveAt}
          phases={phaseList}
          existing={null}
          workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, ownerName: w.ownerName, departmentId: w.departmentId }))}
          requireWorkstream={!isSingleJob}
          onSaved={() => setBanner({ kind: 'ok', text: t('campaigns.deliverableDialog.addedOk') })}
          onFailed={(err) => setBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))}
          onClose={() => setAddingPiece(false)}
        />
      )}
      {promoting && (
        <PromoteDialog
          name={c.name}
          busy={promote.isPending}
          onConfirm={() =>
            promote.mutate(c.id, {
              onSuccess: () => setPromoting(false),
              onError: (err) => { setPromoting(false); setBanner(failed(err, t('intake.promote.failed'), t('deliverables.outsideReach'), t)) },
            })
          }
          onCancel={() => setPromoting(false)}
        />
      )}

      {phasesOpen && c.hasPhases && (
        <PhasesDialog
          campaignId={c.id}
          phases={phaseList}
          countByPhase={countByPhase}
          onBanner={(b) => setBanner(b.err ? failed(b.err, b.text, t('deliverables.outsideReach')) : { kind: b.kind, text: b.text })}
          onClose={() => setPhasesOpen(false)}
        />
      )}


      {pending && (
        <div className="campaign-approval" data-testid="campaign-approval">
          <p data-testid="campaign-pending-note">
            {approverName
              ? t('campaigns.page.pendingNoteNamed', { name: approverName })
              : t('campaigns.page.pendingNote')}
          </p>
          {mayApprove ? (
            <Button
              type="button"
              variant="primary"
              tone="approve"
              busy={approve.isPending}
              onClick={() =>
                approve.mutate(c.id, {
                  // ADR-0111 d.2: a brief field holding only filler is named with its text — an
                  // answer, not a failure to report.
                  onError: (e) => {
                    const filler = fillerRefusalMessage(t, e, (key) => (key === 'proposition' ? t('campaigns.strategy.proposition') : null))
                    setBanner(filler ? { kind: 'error', text: filler } : failed(e, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))
                  },
                })
              }
              data-testid="campaign-approve"
            >
              {t('campaigns.page.approve')}
            </Button>
          ) : (
            <p className="muted" data-testid="campaign-approve-denied">
              {/* "only the account manager can approve" is useless to somebody who has no way to
                  find out who that is — and actively wrong when the answer is NOBODY. */}
              {noApproverAtAll
                ? t('campaigns.page.noAccountManager')
                : approverName
                  ? t('campaigns.page.onlyAccountManagerNamed', { name: approverName })
                  : t('campaigns.page.onlyAccountManager')}
            </p>
          )}
        </div>
      )}
      {/* The kind was hard-coded to `error`, so a successful outcome would have been announced in
          a red dialog. Nothing sent an `ok` banner from this page until the brief writer did. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'ok' ? 'success' : 'error'}
          // I57.38: a refusal is a rule saying no, not a failure — titled so (the schedule's words),
          // never "That did not work". A failure keeps the default title and its Report button.
          title={banner.kind === 'error' && banner.reportable === false ? t('notice.refusedTitle') : undefined}
          message={banner.text}
          // ADR-0092: a FAILURE carries "Report to your administrator" with its cause; a refusal
          // does not. This banner predated that rule and passed neither, so no failure on this
          // page could ever be reported (Edward, 17 Sep, renaming a deliverable before the
          // migration was on production: an error, no Report button).
          reportable={banner.reportable}
          reportWhere="Campaign"
          reportCause={banner.cause}
          testId="campaign-banner"
          onClose={() => setBanner(null)}
        />
      )}

      {/* --- the views (CG-01, I57.4) -------------------------------------------- */}
      {/* The frame's six views of one campaign. They REPLACE the department tabs (Edward, 24 Sep,
          I57 answer 6): the owners' task lists moved into the Grid, adding and editing a piece with
          them, and a single job's brief onto Brief. A view shows here once it is built — a tab that
          opens onto nothing is a dead end (the UI never blocks). */}
      {/* Edward, 24 Sep (option a): the page carries no rings — CG-01 draws none. The progress they
          showed is the grid's Status and Executed, the season map's squares and the brief's "What it
          produced". Phases are managed from here, one press, by their authority (ADR-0096 d.4); a
          single job never sees the word (d.10). */}
      <div className="view-bar">
      <div className="view-tabs" role="tablist" aria-label={t('campaigns.tabs.label')} data-testid="campaign-tabs">
        {views.map((v) => {
          const off = offReason(v)
          return (
            <span key={v} className={off ? 'view-tab-off' : 'view-tab-wrap'}>
              <button
                type="button"
                role="tab"
                aria-selected={shownTab === v}
                disabled={off != null}
                title={off ?? undefined}
                className={shownTab === v ? 'on' : undefined}
                onClick={() => setTab(v)}
                data-testid={`campaign-tab-${v}`}
              >
                {t(`campaigns.tabs.${v}`)}
              </button>
              {off && <InfoTip label={t(`campaigns.tabs.${v}`)} lines={[off]} testId={`campaign-tab-${v}-why`} />}
            </span>
          )
        })}
      </div>
      {/* ADR-0103 d.4: a closed campaign re-opens here as on its card. Offered to anyone who may
          re-open work; the server answers for the rest, in words. */}
      {c.status === 'closed' && can('project_tasks:manage') && (
        <span className="view-bar-actions">
          <Button
            variant="secondary" size="sm" icon="undo" busy={reopenCampaign.isPending}
            onClick={() =>
              reopenCampaign.mutate(c.id, {
                onSuccess: () => setBanner({ kind: 'ok', text: t('reopen.campaignDone') }),
                onError: (e) => setBanner(failed(e, t('reopen.failed'), t('reopen.outsideReach'), t)),
              })
            }
            data-testid="campaign-reopen"
          >
            {t('campaigns.closeOut.reopen')}
          </Button>
        </span>
      )}
      {c.kind !== 'single_job' && mayShapePhases && (
        <span className="view-bar-actions">
          {c.hasPhases ? (
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setPhasesOpen(true)} data-testid="campaign-phases-manage">
              {t('campaigns.phases.manage')}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary" size="sm" busy={setPhases.isPending}
                onClick={() =>
                  setPhases.mutate({ campaignId: c.id, enabled: true }, {
                    onSuccess: () => { setBanner({ kind: 'ok', text: t('campaigns.phases.turnedOn') }); setPhasesOpen(true) },
                    onError: (e) => setBanner(failed(e, t('campaigns.phases.turnOnFailed'), t('deliverables.outsideReach'), t)),
                  })
                }
                data-testid="campaign-phases-on"
              >
                {t('campaigns.phases.turnOn')}
              </Button>
              <InfoTip label={t('campaigns.phases.turnOn')} lines={[t('campaigns.phases.turnOnHint')]} testId="campaign-phases-on-tip" />
            </>
          )}
        </span>
      )}
      </div>

      {/* --- the work failed to load: say so, above the view it truncates --- */}
      {deliverables.isError && (
        <p className="form-error" role="alert" data-testid="campaign-deliverables-failed">
          {t('campaigns.page.deliverablesFailed')}{' '}
          <span data-testid="campaign-deliverables-failed-reason">
            {failureText(deliverables.error)}
          </span>
        </p>
      )}

      {/* --- Brief (CG-07, I57.7) ------------------------------------------------------ */}
      {shownTab === 'brief' && (
        <BriefView
          campaign={c}
          templateFields={templates.data}
          pieces={allDeliverables}
          workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, ownerName: w.ownerName, departmentId: w.departmentId }))}
          phases={phaseList}
          mayEdit={mayShapePhases}
          canManageProjects={can('projects:manage')}
          mayEditJobBrief={mayApprove && c.status !== 'closed'}
          canSeeBudget={can('campaign_budget:view')}
          onOpenPiece={setOpenPieceId}
          onEditPiece={onEditPiece}
          onBanner={setBanner}
          outstandingInputs={inputsMap}
        />
      )}

      {/* --- Where is everything (CG-03, I57.10) --------------------------------------- */}
      {shownTab === 'where' && (
        <WhereIsEverything
          pieces={allDeliverables}
          phases={phaseList}
          workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, departmentId: w.departmentId }))}
          risk={riskMap}
          onOpenPiece={setOpenPieceId}
          onEditPiece={onEditPiece}
          calendar={clientCalendar}
        />
      )}

      {/* --- Season map (CG-02, I57.6) -------------------------------------------------- */}
      {shownTab === 'seasonMap' && (
        <SeasonMap
          pieces={allDeliverables}
          phases={phaseList}
          workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, ownerName: w.ownerName, departmentId: w.departmentId }))}
          outstandingInputs={inputsMap}
          onOpenPiece={setOpenPieceId}
          onEditPiece={onEditPiece}
          calendar={clientCalendar}
        />
      )}

      {/* --- Board (CG-05, I57.8) and Timeline (CG-06, I57.9): the piece and its owner --- */}
      {shownTab === 'board' && (
        <CampaignBoard
          pieces={allDeliverables}
          outstandingInputs={inputsMap}
          onOpenPiece={setOpenPieceId}
          onEditPiece={onEditPiece}
          changeRequests={changeRequests.data}
        />
      )}
      {shownTab === 'timeline' && (
        <CampaignTimeline calendar={clientCalendar} pieces={allDeliverables} outstandingInputs={inputsMap} onOpenPiece={setOpenPieceId} onEditPiece={onEditPiece} />
      )}

      {/* CG-04 (I57.16): the piece, its owner, and its tasks one by one — whichever view opened it. */}
      {openPiece && (
        <PieceDrawer
          piece={openPiece}
          phaseName={openPiece.phaseId ? (phaseList.find((p) => p.id === openPiece.phaseId)?.name ?? null) : null}
          workstreamName={openPiece.workstreamId ? ((workstreams.data ?? []).find((w) => w.id === openPiece.workstreamId)?.name ?? null) : null}
          brief={DRAWER_BRIEF_KEYS.filter((k) => (c.brief[k] ?? '').trim() && c.brief[k] !== 'N/A').map((k) => ({ label: t(`campaigns.strategy.${k}`), value: c.brief[k] }))}
          onEdit={null}
          markTaskId={markTaskId}
          editor={
            mayEditPieces ? (
              <PiecePanel
                key={openPiece.id}
                piece={openPiece}
                campaignId={c.id}
                clientId={c.clientId}
                goLiveAt={c.goLiveAt}
                isSingleJob={isSingleJob}
                phases={phaseList}
                workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
                campaignApproved={isApproved}
                canMovePhase={mayShapePhases && c.hasPhases}
                mayChangeFields={!isApproved || mayApprove}
                viewerId={session?.user?.id ?? null}
                markTaskId={markTaskId}
                onBanner={setBanner}
                onClosed={() => setOpenPieceId(null)}
                onClientChange={() => { setEditPieceId(openPiece.id); setOpenPieceIdState(null) }}
              />
            ) : null
          }
          onReopen={
            reopenable.data?.has(openPiece.id) && (openPiece.taskList ?? []).some((x) => x.status === 'done')
              ? () => { setReopenPieceId(openPiece.id); setOpenPieceId(null) }
              : null
          }
          changeRequest={changeRequests.data?.get(openPiece.id) ?? null}
          amendCount={amendmentsOf(amendAll.data, 'deliverable', openPiece.id)?.amendments ?? 0}
          onClose={() => setOpenPieceId(null)}
        />
      )}

      {reopenPieceId && (
        <ReopenDialog
          deliverableId={reopenPieceId}
          deliverableName={allDeliverables.find((d) => d.id === reopenPieceId)?.name ?? ''}
          onDone={(r) => setBanner({ kind: 'ok', text: reopenDoneText(t, r) })}
          onFailed={(err) => setBanner(failed(err, t('reopen.failed'), t('reopen.outsideReach'), t))}
          onClose={() => setReopenPieceId(null)}
        />
      )}

      {/* CG-E1 (I57.11): Edit a piece — the same dialog the Grid's row opens. */}
      {editPiece && (
        <EditPieceDialog
          piece={editPiece}
          campaignId={c.id}
          clientId={c.clientId}
          goLiveAt={c.goLiveAt}
          phases={phaseList}
          campaignApproved={isApproved}
          canMovePhase={mayShapePhases && c.hasPhases}
          canChangePromise={canChangePromise}
          onClose={() => setEditPieceId(null)}
          onBanner={setBanner}
        />
      )}

      {/* --- Grid (CG-01) ------------------------------------------------------------ */}
      {shownTab === 'grid' && (
        <>
          <CampaignGrid
            campaignId={c.id}
            clientId={c.clientId}
            pieces={allDeliverables}
            workstreams={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, ownerName: w.ownerName, departmentId: w.departmentId }))}
            isCampaign={c.kind !== 'single_job'}
            approvalGroups={(workstreams.data ?? []).map((w) => ({ id: w.id, name: w.name, departmentName: w.departmentName }))}
            phases={phaseList}
            calendar={clientCalendar}
            goLiveAt={c.goLiveAt}
            approved={isApproved}
            failedRead={deliverables.isError}
            canManage={can('project_tasks:manage')}
            // ADR-0132 d.1: "+ Add a deliverable" is on the page's header now, on every tab.
            canAdd={false}
            pendingByDeliverable={pendingByDeliverable}
            canMovePhase={mayShapePhases && c.hasPhases}
            canChangePromise={canChangePromise}
            onOpenPiece={setOpenPieceId}
            onBanner={setBanner}
          />
          {/* ADR-0099 / I56.3: the campaign's workstreams — made, renamed, pieces moved between them.
              Under the sheet they group, since that is the question it answers. */}
          {c.kind !== 'single_job' && (
            <WorkstreamsPanel
              campaignId={campaignId!}
              workstreams={workstreams.data ?? []}
              deliverables={allDeliverables.map((d) => ({
                id: d.id,
                name: d.name,
                workstreamId: d.workstreamId,
                ownerName: d.ownerName,
              }))}
              departments={workDepartmentList}
              people={ownerCandidates}
              canManage={can('projects:manage')}
              testId="campaign-workstreams"
              onError={(message) => setBanner({ kind: 'error', text: message })}
            />
          )}
        </>
      )}

      <footer className="cg-foot">
        <BackButton testId="campaign-back-foot" />
      </footer>
    </section>
  )
}

/** What a thrown query error reads as on screen. The message is the point — a bare "failed" is
 *  what let a 42703 hide for a day. */
function failureText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error ?? '')
}
