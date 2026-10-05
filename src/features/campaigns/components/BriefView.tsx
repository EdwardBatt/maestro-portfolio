import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Button } from '../../../components/Button'
import { BRIEF_FIELD_KEYS, PERFORMANCE_FIELD_KEYS, isPerformanceField, type BriefFieldKey } from '../../../lib/brief/fields'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import { RULES_KEY } from '../../../lib/brief/rules'
import { failed, type Banner } from '../../deliverables/DeliverablesPage'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import { useUpdateCampaignBrief, useUpdateSingleJobBrief, type CampaignDetail, type CampaignPhase, type DepartmentBrief } from '../api/campaign-detail-api'
import { masterBriefText, useSaveDepartmentBrief } from '../api/department-briefs-api'
import { useIngestBrief } from '../api/brief-ingest-api'
import { gridGroups, NO_FILTERS, type GridWorkstream } from '../lib/campaign-grid'
import { departmentSections } from '../lib/department-sections'
import { orderSquares } from '../lib/season-map'
import { BriefApproval } from './BriefApproval'
import { ConceptsPanel } from './ConceptsPanel'
import { GenerateDeliverablesDialog } from './GenerateDeliverablesDialog'
import { PieceSquare, SquareLegend } from './PieceSquare'

/** I56.28 (Edward, 24 Sep): concepts are off the page until it is decided where they live. */
const SHOW_CONCEPTS = false

/**
 * The Brief view (Figma CG-07, I57.7) — the campaign brief and what it produced.
 *
 * It replaces the Brief tab's inline code on the campaign page and keeps everything that worked
 * there, with the same test ids: the master brief read and edited in place by the campaign's
 * approval authority (I53.4), new pieces proposed from it (Generate), the performance flight when
 * the campaign has one, and the department briefs — a single job's one brief keeps its edit; on a
 * campaign they are retired (ADR-0100 d.6) and shown read only.
 *
 * What CG-07 adds: the brief in its numbered parts with "n of m" written, an EMPTY tag on a field
 * nobody wrote, and a rail — the brief itself (fields filled, approved, last edited, inherited by),
 * what it produced (one square per PIECE by workstream, opening the drawer), and, when fields are
 * empty, a callout naming them with "Fill them in", which starts the edit.
 *
 * The advertising budget shows only to `campaign_budget:view` (I56.18), as on the wizard: hidden
 * on screen, not locked — an edit writes it back untouched.
 *
 * Props:
 * - `campaign` — the campaign detail (`useCampaignDetail().data`).
 * - `templateFields` — department brief templates by brief type (`useBriefTemplateFields().data`),
 *   for the department briefs' labels.
 * - `pieces` — every piece on the campaign (`useCampaignDeliverables().data`); archived ones are left out here.
 * - `workstreams` — the campaign's workstreams, `{ id, name, ownerName }`.
 * - `phases` — the campaign's phases (empty when off), handed to Generate.
 * - `mayEdit` — the campaign's approval authority, not closed, not a single job (the page's `mayShapePhases`).
 * - `canManageProjects` — `projects:manage`: a single job's brief may be edited until approved.
 * - `mayEditJobBrief` — the campaign's approval authority, not closed: a RELEASED single job's brief
 *   is edited by hand (ADR-0104 d.3).
 * - `canSeeBudget` — `campaign_budget:view`.
 * - `onOpenPiece` — opens the CG-04 drawer. `onEditPiece` — accepted for the shared shape; unused.
 * - `onBanner` — the page's notice dialog.
 * - `today` — epoch ms standing in for now (tests only).
 */
export interface BriefViewProps {
  campaign: CampaignDetail
  templateFields: Record<string, readonly { key: string; en: string }[]> | undefined
  pieces: readonly DeliverableRow[]
  workstreams: readonly GridWorkstream[]
  phases: readonly CampaignPhase[]
  mayEdit: boolean
  canManageProjects: boolean
  mayEditJobBrief?: boolean
  canSeeBudget: boolean
  onOpenPiece: (id: string) => void
  onEditPiece?: ((id: string) => void) | null
  /** Outstanding inputs per deliverable — a waiting one is Waiting here as on the Season map (I57.22). */
  outstandingInputs?: ReadonlyMap<string, number>
  onBanner: (b: Banner) => void
  today?: number
}

interface Part {
  key: 'context' | 'audience' | 'idea' | 'journey'
  number: number
  fields: readonly BriefFieldKey[]
}

/** The parts, as the wizard's brief step orders them (`BriefStepContainer.partsFor`). */
function partsFor(canSeeBudget: boolean): readonly Part[] {
  return [
    { key: 'context', number: 1, fields: ['background', 'task', 'beautifulProblem'] },
    { key: 'audience', number: 2, fields: ['audiencePrimary', 'audienceSecondary', 'brandFunctionalBenefit', 'brandEmotionalBenefit'] },
    { key: 'idea', number: 3, fields: ['insight', 'proposition'] },
    { key: 'journey', number: 4, fields: canSeeBudget ? PERFORMANCE_FIELD_KEYS : PERFORMANCE_FIELD_KEYS.filter((f) => f !== 'perfBudget') },
  ]
}

const written = (v: string | undefined) => (v ?? '').trim() !== ''
/** N/A is a considered answer (ADR-0048 d.6), not a gap. */
const isNA = (v: string | undefined) => (v ?? '').trim() === 'N/A'

export function BriefView({
  campaign: c,
  templateFields,
  pieces,
  workstreams,
  phases,
  mayEdit,
  canManageProjects,
  mayEditJobBrief = false,
  canSeeBudget,
  onOpenPiece,
  onBanner,
  outstandingInputs,
  today,
}: BriefViewProps) {
  const { t } = useTranslation()
  const updateBrief = useUpdateCampaignBrief()
  const ingest = useIngestBrief()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const now = today ?? Date.now()

  const labelOf = (k: BriefFieldKey) => t(isPerformanceField(k) ? `campaigns.performance.${k}` : `campaigns.strategy.${k}`)
  const parts = partsFor(canSeeBudget)
  // The performance flight is a part only when the campaign has one: five "Not applicable" panels
  // on a purely creative campaign are five panels of nothing.
  const hasFlight = parts[3].fields.some((k) => written(c.brief[k]) && !isNA(c.brief[k]))
  const shownParts = hasFlight ? parts : parts.slice(0, 3)
  const counted = shownParts.flatMap((p) => p.fields)
  const emptyFields = counted.filter((k) => !written(c.brief[k]))
  const filled = counted.length - emptyFields.length

  const live = pieces.filter((d) => d.state !== 'archived')
  const groups = gridGroups(pieces, workstreams, NO_FILTERS)
  const byDepartment = workstreams.length === 0
  const sections = departmentSections([...pieces], c.briefs)

  const startEdit = () => { setDraft({ ...c.brief }); setEditing(true) }
  const editKeys = BRIEF_FIELD_KEYS.filter((k) => canSeeBudget || k !== 'perfBudget')

  const departmentBriefs = c.briefs
    .filter((b) => Object.keys(b.values ?? {}).length > 0)
    .map((b) => {
      const key = b.departmentId ?? 'none'
      const labels = new Map((templateFields?.[b.briefType ?? ''] ?? []).map((f) => [f.key, f.en]))
      return (
        <section key={b.id} className="campaign-department" data-testid={`campaign-department-${key}`}>
          <h2 className="org-section-heading">
            {c.kind === 'single_job'
              ? t('campaigns.page.masterBrief')
              : `${sections.find((s) => s.departmentId === b.departmentId)?.name ?? t('campaigns.page.unassignedDepartment')}`}
          </h2>
          {c.kind !== 'single_job' && b.approvedAt && (
            <BriefApproval
              approvedAt={b.approvedAt}
              approvedByName={b.approvedByName}
              testId={`campaign-brief-approval-${key}`}
            />
          )}
          <BriefEditor
            brief={b}
            values={b.values}
            labelFor={(k) => labels.get(k) ?? k}
            // ADR-0104 d.3: before release by whoever may manage projects; once released, by the
            // campaign's approval authority, through its own door. A campaign's legacy department
            // brief is never edited (d.4).
            canEdit={c.kind === 'single_job' && (b.approvedAt ? mayEditJobBrief : canManageProjects)}
            released={c.kind === 'single_job' && Boolean(b.approvedAt)}
            testId={`campaign-department-brief-${key}`}
          />
          {/* ADR-0065: concepts hang off the brief. OFF THE PAGE for now (I56.28, Edward 24 Sep:
              "do not remove the code, just leave it off the page"). */}
          {SHOW_CONCEPTS && <ConceptsPanel briefId={b.id} canPropose={canManageProjects} testId={`campaign-concepts-${key}`} />}
        </section>
      )
    })

  // A single job has no master brief: its one brief is its department's, as it always was.
  if (c.kind === 'single_job') {
    return (
      <div role="tabpanel" data-testid="campaign-panel-brief">
        {departmentBriefs}
      </div>
    )
  }

  const fieldNames = emptyFields.map(labelOf).join(t('campaigns.briefView.and'))

  // ADR-0104 d.2: a promoted job's campaign brief is generated from the job's own words and brief —
  // the model fills the fields, the account manager reads and saves them. Offered while any field
  // is still empty; nothing waits on it.
  const job = c.promotedJob
  const mayGenerate = mayEdit && !editing && job != null && emptyFields.length > 0
  const generateBrief = () => {
    if (!job) return
    const text = [
      `Campaign: ${c.name}`,
      job.words ? `What the client asked for:\n${job.words}` : '',
      ...Object.entries(job.values).filter(([k]) => k !== 'briefType').map(([k, v]) => `${k}:\n${v}`),
      ...Object.entries(c.brief).filter(([k, v]) => (BRIEF_FIELD_KEYS as readonly string[]).includes(k) && written(v)).map(([k, v]) => `${k}:\n${v}`),
    ].filter(Boolean).join('\n\n')
    ingest.mutate({ text }, {
      onSuccess: (r) => {
        const next: Record<string, string> = {}
        for (const k of editKeys) next[k] = c.brief[k] ?? ''
        for (const [k, v] of Object.entries(r.fields)) if (typeof v === 'string' && v.trim() && !written(next[k])) next[k] = v
        setDraft(next)
        setEditing(true)
        onBanner({ kind: 'ok', text: t(r.source === 'model' ? 'campaigns.briefView.generated' : 'campaigns.briefView.generatedFallback') })
      },
      onError: (err) => onBanner(failed(err, t('campaigns.briefView.generateFailed'), t('deliverables.outsideReach'), t)),
    })
  }

  return (
    <div role="tabpanel" className="brief-view" data-testid="campaign-panel-brief">
      <div className="brief-view-main">
        <details className="campaign-collapse brief-view-doc" open data-testid="campaign-master-brief-details">
          <summary>
            <h2 className="org-section-heading">{t('campaigns.page.masterBrief')}</h2>
          </summary>

          {/* The head card: what this is, whether it is approved, when it last changed, and Edit. */}
          <div className="brief-view-head" data-testid="brief-view-head">
            <div className="brief-view-tags">
              <span className="tag tag-accent" data-testid="brief-view-fields-tag">{t('campaigns.briefView.fieldsTag', { count: counted.length })}</span>
              {c.approvedAt && (
                <span className="tag tag-ok" data-testid="brief-view-approved-tag">
                  {t('campaigns.briefView.approvedTag', { date: formatIraqShortDate(c.approvedAt) })}
                </span>
              )}
              {c.updatedAt && (
                <span className="tag tag-neutral" data-testid="brief-view-edited-tag">
                  {t('campaigns.briefView.editedTag', { date: formatIraqShortDate(c.updatedAt) })}
                </span>
              )}
            </div>
            {/* I53.4: a released campaign's brief is edited HERE, by the campaign's approval
                authority, and new pieces are proposed from it — existing ones are never touched. */}
            {mayEdit && !editing && (
              <div className="section-actions brief-view-head-actions" data-testid="campaign-brief-actions">
                {mayGenerate && (
                  <Button variant="primary" size="sm" busy={ingest.isPending} onClick={generateBrief} data-testid="campaign-brief-generate">
                    {t('campaigns.briefView.generate')}
                  </Button>
                )}
                <Button variant="secondary" size="sm" icon="edit" onClick={startEdit} data-testid="campaign-brief-edit">
                  {t('campaigns.briefView.editBrief')}
                </Button>
                <Button variant="secondary" size="sm" icon="plus" onClick={() => setGenerating(true)} data-testid="campaign-generate-deliverables">
                  {t('campaigns.generate.open')}
                </Button>
              </div>
            )}
            {written(c.brief.proposition) && !isNA(c.brief.proposition) && (
              <p className="brief-view-headline" data-testid="brief-view-headline">{c.brief.proposition}</p>
            )}
          </div>

          {editing ? (
            <form
              className="brief-grid-edit"
              onSubmit={(e) => {
                e.preventDefault()
                const next: Record<string, string> = {}
                for (const [k, v] of Object.entries(draft)) if (v.trim()) next[k] = v.trim()
                updateBrief.mutate(
                  { campaignId: c.id, brief: { ...c.brief, ...next, ...Object.fromEntries(Object.keys(c.brief).filter((k) => !(k in next)).map((k) => [k, ''])) } },
                  {
                    onSuccess: () => { setEditing(false); onBanner({ kind: 'ok', text: t('campaigns.page.briefSaved') }) },
                    onError: (err) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t)),
                  },
                )
              }}
            >
              {editKeys.map((k) => (
                <label key={k} className="form-field-wide">
                  {labelOf(k)}
                  <textarea
                    rows={2}
                    value={draft[k] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [k]: e.target.value }))}
                    data-testid={`campaign-master-brief-field-${k}`}
                  />
                </label>
              ))}
              <div className="dialog-actions">
                <Button variant="secondary" type="button" onClick={() => setEditing(false)} disabled={updateBrief.isPending} data-testid="campaign-master-brief-cancel">
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" type="submit" busy={updateBrief.isPending} disabled={updateBrief.isPending} data-testid="campaign-master-brief-save">
                  {t('common.save')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="brief-view-parts" data-testid="campaign-master-brief">
                {shownParts.slice(0, 3).map((p) => (
                  <BriefPart key={p.key} part={p} values={c.brief} labelOf={labelOf} testId="campaign-master-brief" />
                ))}
              </div>
              {hasFlight && (
                <BriefPart part={parts[3]} values={c.brief} labelOf={labelOf} testId="campaign-perf-brief" bodyTestId="campaign-perf-brief" headingTestId="campaign-perf-heading" />
              )}
            </>
          )}

          {generating && (
            <GenerateDeliverablesDialog
              campaignId={c.id}
              briefText={`Campaign: ${c.name}\n\n${masterBriefText(c.brief)}`}
              existingNames={pieces.map((d) => d.name)}
              phases={phases}
              workstreams={workstreams}
              requireWorkstream  // this branch is a campaign's (a single job's brief has no propose-more)
              onDone={({ added, failed: failedCount, firstError }) => {
                if (failedCount === 0) onBanner({ kind: 'ok', text: t('campaigns.generate.added', { count: added }) })
                else onBanner(failed(firstError, t('campaigns.generate.someFailed', { added, failed: failedCount }), t('deliverables.outsideReach')))
              }}
              onClose={() => setGenerating(false)}
            />
          )}
        </details>

        {/* The department briefs. A SINGLE JOB's one brief is handled above; on a campaign they are
            RETIRED (ADR-0100 d.6): one that already carries them shows them read only. */}
        {departmentBriefs}
      </div>

      <aside className="brief-view-rail" data-testid="brief-view-rail">
        <section className="brief-view-card" data-testid="brief-itself">
          <h3 className="brief-view-card-title">{t('campaigns.briefView.itself')}</h3>
          <dl className="brief-view-facts">
            <dt>{t('campaigns.briefView.filled')}</dt>
            <dd className={emptyFields.length > 0 ? 'is-warn' : undefined} data-testid="brief-itself-filled">
              {t('campaigns.briefView.ofCount', { n: filled, count: counted.length })}
            </dd>
            <dt>{t('campaigns.briefView.approved')}</dt>
            <dd data-testid="brief-itself-approved">
              {c.approvedAt ? formatIraqShortDate(c.approvedAt) : t('campaigns.briefView.notApproved')}
            </dd>
            {c.updatedAt && (
              <>
                <dt>{t('campaigns.briefView.lastEdited')}</dt>
                <dd data-testid="brief-itself-edited">
                  {[formatIraqShortDate(c.updatedAt), c.updatedByName].filter(Boolean).join(' · ')}
                </dd>
              </>
            )}
            <dt>{t('campaigns.briefView.inheritedBy')}</dt>
            <dd data-testid="brief-itself-inherited">
              {[
                t('campaigns.briefView.deliverables', { count: live.length }),
                workstreams.length > 0 ? t('campaigns.briefView.workstreams', { count: workstreams.length }) : null,
              ].filter(Boolean).join(' · ')}
            </dd>
          </dl>
        </section>

        <section className="brief-view-card" data-testid="brief-produced">
          <h3 className="brief-view-card-title">
            {t('campaigns.briefView.produced')}
            <span className="brief-view-card-aside">{t(byDepartment ? 'campaigns.briefView.byDepartment' : 'campaigns.briefView.byWorkstream')}</span>
          </h3>
          {groups.length === 0 ? (
            <p className="muted" data-testid="brief-produced-none">{t('campaigns.briefView.producedNone')}</p>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.key} className="brief-produced-group" data-testid={`brief-produced-${g.key}`}>
                  <div className="brief-produced-head">
                    <span className="brief-produced-name">
                      {g.name ?? t(g.kind === 'none' && !byDepartment ? 'campaigns.grid.noWorkstream' : 'campaigns.page.unassignedDepartment')}
                    </span>
                    <span className="brief-produced-line" data-testid={`brief-produced-line-${g.key}`}>
                      {t('campaigns.seasonMap.delivered', { delivered: g.delivered, count: g.total })}
                    </span>
                  </div>
                  <div className="brief-produced-squares">
                    {orderSquares(g.rows, now, outstandingInputs).map((s) => (
                      <PieceSquare key={s.piece.id} piece={s.piece} status={s.status} onOpen={onOpenPiece} />
                    ))}
                  </div>
                </div>
              ))}
              <SquareLegend testId="brief-produced-legend" />
            </>
          )}
        </section>

        {emptyFields.length > 0 && (
          <section className="brief-view-card brief-empty-callout" data-testid="brief-empty-callout">
            <h3 className="brief-view-card-title">{t('campaigns.briefView.emptyTitle', { count: emptyFields.length })}</h3>
            <p data-testid="brief-empty-fields">{t('campaigns.briefView.emptyBody', { count: emptyFields.length, fields: fieldNames })}</p>
            {mayEdit && !editing && (
              <Button variant="danger" size="sm" onClick={startEdit} data-testid="brief-empty-fill">
                {t('campaigns.briefView.fill', { count: emptyFields.length })}
              </Button>
            )}
          </section>
        )}
      </aside>
    </div>
  )
}

/** One numbered part of the brief: its fields, "n of m" written, and an EMPTY tag where nobody wrote. */
function BriefPart({
  part,
  values,
  labelOf,
  testId,
  bodyTestId,
  headingTestId,
}: {
  part: Part
  values: Record<string, string>
  labelOf: (k: BriefFieldKey) => string
  /** Prefix of each field's id: `<testId>-<key>`, `<testId>-empty-<key>`. */
  testId: string
  bodyTestId?: string
  headingTestId?: string
}) {
  const { t } = useTranslation()
  const n = part.fields.filter((k) => written(values[k])).length
  return (
    <section className="brief-part" data-testid={`brief-part-${part.key}`}>
      <h3 className="brief-part-title" data-testid={headingTestId}>
        {part.number} · {t(`brief.part.${part.key}`)}
        <span className="tag tag-neutral brief-part-count" data-testid={`brief-part-count-${part.key}`}>
          {t('campaigns.briefView.ofCount', { n, count: part.fields.length })}
        </span>
      </h3>
      <dl className="brief-part-fields" data-testid={bodyTestId}>
        {part.fields.map((k) => {
          const v = values[k] ?? ''
          const empty = !written(v)
          const na = isNA(v)
          return (
            <div key={k} className={`brief-part-field${empty ? ' is-empty' : ''}${na ? ' is-na' : ''}`}>
              <dt>
                {labelOf(k)}
                {empty && <span className="tag tag-breach brief-part-empty-tag" data-testid={`${testId}-empty-${k}`}>{t('campaigns.briefView.empty')}</span>}
              </dt>
              <dd dir="auto" data-testid={`${testId}-${k}`}>
                {empty ? t('campaigns.briefView.notWritten') : na ? t('campaigns.page.briefFieldNA') : v}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

/**
 * A department's brief, read and corrected in the same place (ADR-0048 d.9, I16.6) — moved here
 * with the Brief tab from `CampaignPage`. **The approver is the corrector**: Edit turns the same
 * fields into inputs, and Save writes the whole document back.
 */
function BriefEditor({
  brief,
  values,
  labelFor,
  canEdit,
  released = false,
  testId,
}: {
  brief: DepartmentBrief
  values: Record<string, string>
  labelFor: (key: string) => string
  canEdit: boolean
  /** ADR-0104 d.3: a released single job's brief is saved through its own door, not the table. */
  released?: boolean
  testId: string
}) {
  const { t } = useTranslation()
  const saveDraft = useSaveDepartmentBrief()
  const saveReleased = useUpdateSingleJobBrief()
  const { campaignId } = useParams()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>(values)
  const [error, setError] = useState<string | null>(null)

  const entries = Object.entries(values).filter(([k]) => !HIDDEN_BRIEF_KEYS.has(k))

  if (!editing) {
    return (
      <>
        <BriefReader values={values} labelFor={labelFor} testId={testId} />
        {canEdit && (
          <Button
            variant="secondary" size="sm" icon="edit"
            onClick={() => { setDraft(values); setError(null); setEditing(true) }}
            data-testid={`${testId}-edit`}
          >
            {t('campaigns.page.editBrief')}
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="brief-editor" data-testid={`${testId}-editing`}>
      {entries.map(([key]) => (
        <div key={key} className="form-field-wide brief-field">
          <label htmlFor={`${testId}-${key}-input`}>{labelFor(key)}</label>
          <textarea
            id={`${testId}-${key}-input`}
            rows={2}
            value={draft[key] ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
            data-testid={`${testId}-input-${key}`}
          />
        </div>
      ))}
      {error && <p className="form-error" data-testid={`${testId}-error`}>{error}</p>}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={() => setEditing(false)} data-testid={`${testId}-cancel`}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          busy={saveDraft.isPending || saveReleased.isPending}
          onClick={() => {
            const done = {
              onSuccess: () => { setEditing(false); setError(null) },
              onError: (e: unknown) => setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
            }
            // The whole document, not a patch: a brief is edited as one thing.
            if (released) saveReleased.mutate({ campaignId: campaignId ?? '', values: draft }, done)
            else saveDraft.mutate({ briefId: brief.id, campaignId: campaignId ?? '', values: draft }, done)
          }}
          data-testid={`${testId}-save`}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Keys a job's brief carries that are not the brief's words: its type, and the client's rules
 * snapshotted in at release (`lib/brief/rules`). Shown as a field the rules read as `[]` / JSON;
 * edited as text they would be overwritten — they are the client's, locked. (The risk line,
 * `whatCouldStopThis`, IS the account manager's words and stays.)
 */
const HIDDEN_BRIEF_KEYS = new Set(['briefType', RULES_KEY])

/** Over this many characters a panel takes two columns (I34.7: width decided by the content). */
const WIDE_AT = 240

/** A department brief, read (I34.7). `N/A` recedes rather than disappearing (ADR-0048 d.6). */
function BriefReader({
  values,
  labelFor,
  testId,
}: {
  values: Record<string, string>
  labelFor: (key: string) => string
  testId: string
}) {
  const { t } = useTranslation()
  const entries = Object.entries(values).filter(([k]) => !HIDDEN_BRIEF_KEYS.has(k))
  if (entries.length === 0) {
    return <p className="muted" data-testid={`${testId}-empty`}>{t('campaigns.page.briefEmpty')}</p>
  }
  return (
    <dl className="brief-grid" data-testid={testId}>
      {entries.map(([key, value]) => {
        const na = value === 'N/A' || value.trim() === ''
        return (
          <div key={key} className={`brief-panel${value.length > WIDE_AT ? ' is-wide' : ''}${na ? ' is-na' : ''}`}>
            <dt>{labelFor(key)}</dt>
            <dd dir="auto" data-testid={`${testId}-${key}`}>{na ? t('campaigns.page.briefFieldNA') : value}</dd>
          </div>
        )
      })}
    </dl>
  )
}
