import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { workstreamHue as hueFor } from '../../../lib/campaigns/workstream-hue'

/**
 * **Review and approve** — step 5 of the campaign wizard (Figma `CB-v3-05`, `I56.12`).
 *
 * The last screen of the wizard is not a summary. It is the moment the campaign stops being a
 * draft and starts costing people their day: ADR-0067 says the campaign already exists from step
 * 2, so nothing here *creates* anything — what this press does is start the clocks (ADR-0076),
 * put every workstream in a lead's queue (ADR-0099) and begin the escalation timer on work nobody
 * has picked up (ADR-0045). So the screen is built around telling the approver exactly that,
 * before they press, rather than after.
 *
 * Three things the frame settles and this keeps:
 *
 *  - **It names the approver and rules out a second signature.** ADR-0083 addendum d.14: the
 *    campaign's account manager approves it, and no director countersigns. The rail says so in
 *    words, because "who else has to look at this?" is the question that otherwise gets asked in
 *    the group chat.
 *  - **"What approving does" is a list of consequences, not of features** — each line is a real
 *    number taken from the campaign in front of you. A generic list would be decoration, and
 *    decoration is what this codebase keeps removing.
 *  - **"Not ready?" is offered as plainly as approving is.** Saving a draft must not read as
 *    failure; the wizard's whole shape depends on people leaving half-done work behind.
 *
 * The workstream table's left bar is **categorical** (`--hue-1..12`, index.css): it separates
 * kinds, it never reports state. Green, amber and red stay reserved for on-track / at-risk /
 * breached, per `.claude/skills/maestro-design/SKILL.md`.
 *
 * Presentational (AGENTS.md §4): props in, callbacks out. It runs no query, it writes nothing,
 * and it does not know whether the press will be refused — `canApprove` is the caller's reading
 * of the authority, and the server is still the one that decides.
 */

/** One row of *Who gets what* — a workstream, its department, its size and who hands it out. */
export interface ReviewWorkstream {
  id: string
  name: string
  departmentName: string
  pieceCount: number
  /** The lead who assigns inside this workstream. Null when nobody owns it yet (ADR-0099). */
  assignerName: string | null
  /**
   * What the row's end says instead of "X assigns" — for the rows a campaign WITHOUT workstreams
   * shows, one per owner, where the owner is the row and the tail is what they will be asked to do.
   */
  tail?: string
  /**
   * `1`–`12` — the categorical hue this workstream is drawn with everywhere. Left out, the row
   * takes a stable colour derived from its id, so the same workstream keeps the same bar between
   * renders and between screens.
   */
  hue?: number
}

/** The facts strip under the brief. Dates arrive **already formatted** — this file owns no clock. */
export interface ReviewFacts {
  pieces: number
  /** "Fri 18 Sep". Null when the campaign has no launch date yet. */
  launch: string | null
  /** "Fri 16 Oct". Null when there is no end date. */
  finale: string | null
  /** "AR · EN · KU" — joined by the caller, which knows the locale's separator. */
  languages: string | null
  /** "7 + client" — how many rules the brief carries, and whether the client added their own. */
  rules: string | null
}

export interface ReviewApprover {
  name: string
  /** "Account manager on Kite" — the role, qualified by the client it is held on. */
  roleLine: string
}

/** A monogram, because the frame's avatar is a circle with no photograph behind it. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = [...parts[0]][0] ?? ''
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

export function ReviewStepV3({
  campaignName,
  clientName,
  brandName,
  briefSummary,
  facts,
  phaseCount,
  workstreams,
  grouping = true,
  ownerCount,
  approver,
  libraryPath,
  escalationHours,
  canApprove,
  approving = false,
  onApprove,
  onSaveDraft,
  onBack,
  onEditStep,
  testId = 'approve',
}: {
  campaignName: string
  clientName: string
  brandName: string | null
  /** The brief in the approver's own words — the paragraph, not a rendering of the whole brief. */
  briefSummary: string
  facts: ReviewFacts
  /** `0` when the campaign does not run in phases (ADR-0096 d.1) — then no chip is drawn. */
  phaseCount: number
  workstreams: ReviewWorkstream[]
  /** ADR-0101 d.9: false when the campaign does not use workstreams — the rows are then its owners. */
  grouping?: boolean
  /** How many people own a piece — each is told, and approves their task lists (ADR-0100 d.2). */
  ownerCount: number
  approver: ReviewApprover
  /** "Kite → LUMA → Season 2" — where approving files the campaign's folders (ADR-0022). */
  libraryPath: string
  /** ADR-0045: how long unassigned work sits before it starts being chased. */
  escalationHours: number
  /** The caller's reading of ADR-0083 d.14. False leaves the button in place and says why. */
  canApprove: boolean
  approving?: boolean
  onApprove: () => void
  onSaveDraft: () => void
  onBack: () => void
  onEditStep: () => void
  testId?: string
}) {
  const { t } = useTranslation()

  // "Six leads get their workstream in their queue" — the people, not the workstreams. Two
  // workstreams handed to the same lead are one notification, so counting rows would overstate it.
  const leadCount = new Set(
    workstreams.map((w) => w.assignerName).filter((n): n is string => n != null),
  ).size

  const fact = (key: string, value: string | null, slug: string) => (
    <div className="approve-fact" key={slug}>
      <span className="approve-fact-label">{t(key)}</span>
      <span className="approve-fact-value" data-testid={`${testId}-fact-${slug}`}>
        {value ?? '—'}
      </span>
    </div>
  )

  return (
    <div className="approve-step" data-testid={testId}>
      <h2 className="approve-title">{t('approve.title')}</h2>
      <p className="approve-lede" data-testid={`${testId}-lede`}>
        {t('approve.lede', { client: clientName })}
      </p>

      <div className="approve-columns">
        <div className="approve-main">
          {/* The campaign itself, inside the violet edge: this is the thing being approved, and
              the border is the one place on the screen that shouts. */}
          <section className="approve-card approve-card-subject">
            <header className="approve-subject-head">
              <span className="approve-chip approve-chip-accent" data-testid={`${testId}-chip-client`}>
                {brandName ? t('approve.chip.clientBrand', { client: clientName, brand: brandName }) : clientName}
              </span>
              {phaseCount > 0 && (
                <span className="approve-chip" data-testid={`${testId}-chip-phases`}>
                  {t('approve.chip.phases', { count: phaseCount })}
                </span>
              )}
              {grouping && workstreams.length > 0 && (
                <span className="approve-chip" data-testid={`${testId}-chip-workstreams`}>
                  {t('approve.chip.workstreams', { count: workstreams.length })}
                </span>
              )}
              <span className="approve-spacer" />
              <Button
                variant="link"
                className="approve-edit"
                onClick={onEditStep}
                data-testid={`${testId}-edit`}
              >
                {t('approve.editAnyStep')}
              </Button>
            </header>

            <p className="approve-campaign-name" data-testid={`${testId}-name`}>
              {campaignName}
            </p>
            <p className="approve-brief" data-testid={`${testId}-brief`}>
              {briefSummary}
            </p>

            <div className="approve-facts">
              {fact('approve.facts.pieces', String(facts.pieces), 'pieces')}
              {fact('approve.facts.launch', facts.launch, 'launch')}
              {fact('approve.facts.finale', facts.finale, 'finale')}
              {fact('approve.facts.languages', facts.languages, 'languages')}
              {fact('approve.facts.rules', facts.rules, 'rules')}
            </div>
          </section>

          <section className="approve-card">
            <h3 className="approve-card-title">{t('approve.whoGetsWhat')}</h3>
            {workstreams.map((w) => (
              <div
                className="approve-row"
                key={w.id}
                data-hue={w.hue ?? hueFor(w.id)}
                data-testid={`${testId}-row-${w.id}`}
              >
                <span className="approve-row-bar" aria-hidden="true" />
                <span className="approve-row-name">{w.name}</span>
                <span className="approve-row-department">{w.departmentName}</span>
                <span className="approve-row-pieces" data-testid={`${testId}-row-${w.id}-pieces`}>
                  {t('approve.pieces', { count: w.pieceCount })}
                </span>
                {/* Who hands the work out. ADR-0099: a workstream has an owner, and until it does
                    the row says so rather than leaving a gap nobody can interpret. */}
                <span className="approve-row-assigner" data-testid={`${testId}-row-${w.id}-assigner`}>
                  {w.tail ??
                    (w.assignerName
                      ? t('approve.assigns', { name: w.assignerName })
                      : t('approve.noAssigner'))}
                </span>
              </div>
            ))}
          </section>
        </div>

        <aside className="approve-rail">
          <section className="approve-card approve-card-mine">
            <h3 className="approve-rail-title approve-rail-title-accent">{t('approve.yours')}</h3>
            <div className="approve-approver" data-testid={`${testId}-approver`}>
              <span className="approve-avatar" aria-hidden="true">
                {initialsOf(approver.name)}
              </span>
              <span className="approve-approver-lines">
                <span className="approve-approver-name">{approver.name}</span>
                <span className="approve-approver-role">{approver.roleLine}</span>
              </span>
            </div>
            {/* ADR-0083 addendum d.14, said out loud: there is no second signature to wait for. */}
            <p className="approve-no-director">{t('approve.noDirector')}</p>
          </section>

          <section className="approve-card">
            <h3 className="approve-rail-title">{t('approve.whatItDoes')}</h3>
            <ul className="approve-bullets" data-testid={`${testId}-consequences`}>
              <li>{t('approve.does.clocks', { count: facts.pieces })}</li>
              {/* ADR-0100 d.2: the owners are the second gate — told on approval (the
                  `campaign_approved` mail), and nothing is assigned until each accepts its list. */}
              <li data-testid={`${testId}-does-owners`}>{t('approve.does.owners', { count: ownerCount })}</li>
              {grouping && leadCount > 0 && <li>{t('approve.does.leads', { count: leadCount })}</li>}
              <li>{t('approve.does.grid')}</li>
              <li>{t('approve.does.library', { path: libraryPath })}</li>
              <li>{t('approve.does.escalation', { count: escalationHours })}</li>
            </ul>
          </section>

          <section className="approve-card approve-card-quiet">
            <h3 className="approve-rail-title">{t('approve.notReady')}</h3>
            <p className="approve-quiet-body">{t('approve.notReadyBody')}</p>
          </section>
        </aside>
      </div>

      <footer className="approve-actions">
        <Button
          variant="primary"
          tone="approve"
          className="approve-go"
          disabled={!canApprove}
          busy={approving}
          onClick={onApprove}
          data-testid={`${testId}-approve`}
        >
          {t('approve.go')}
          <span className="approve-arrow" aria-hidden="true">
            ▸
          </span>
        </Button>
        <Button variant="secondary" onClick={onSaveDraft} data-testid={`${testId}-draft`}>
          {t('approve.saveDraft')}
        </Button>
        <Button variant="secondary" onClick={onBack} data-testid={`${testId}-back`}>
          {t('approve.back')}
        </Button>
        <span className="approve-spacer" />
        {/* A refusal names who can (Edward, 22 Sep) — an unpressable button on its own is a dead
            end, and the reader's next move is to go and find that person. */}
        {canApprove ? (
          <p className="approve-record">{t('approve.onTheRecord')}</p>
        ) : (
          <p className="approve-record" data-testid={`${testId}-not-yours`}>
            {t('approve.notYours', { name: approver.name })}
          </p>
        )}
      </footer>
    </div>
  )
}
