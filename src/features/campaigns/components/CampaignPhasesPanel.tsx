import { useTranslation } from 'react-i18next'

/**
 * **The phases** — the right-hand panel of step 1 of the campaign wizard (Figma `CB-v3-01`,
 * `I56.10`, ADR-0096).
 *
 * A phase is a stretch of the campaign with a start date and an end date, and every piece inside it
 * plans back from the end date. The frame's "ends on an event" chips are gone (Edward, 24 Sep): a
 * date is something a person can set, an event is not.
 *
 * **No switch** (ADR-0116, Edward 27 Sep): the card is the frame's — a line and "+ Add a phase". A
 * campaign uses phases when it has one; removing the last one means it no longer does.
 *
 * The left bar follows the frame: a neutral hairline, violet on the phase the campaign is in now.
 * It is a position marker, not a category, so it takes no `--hue-*`.
 *
 * Presentational (AGENTS.md §4): dates arrive already formatted, every press goes back out as a
 * callback, and nothing here calls an RPC.
 */
export interface CampaignPhaseRow {
  id: string
  /** "Week 1", "Pre-Launch" — the account manager's own name for it (ADR-0096 d.2). */
  name: string
  /** "12 – 18 Sep", "17 Oct +" — formatted by the caller, which knows the locale. */
  dates: string
  /** The phase the campaign is in today. At most one row should carry it. */
  isCurrent?: boolean
}

export function CampaignPhasesPanel({
  phases,
  note,
  onAddPhase,
  onEditPhase,
  testId = 'phases',
}: {
  phases: CampaignPhaseRow[]
  /**
   * The campaign's own rhythm, in the client's words — "LUMA runs on Friday draw nights, so every
   * week ends on one." Null on a campaign that has no such story; the general sentence still runs.
   */
  note?: string | null
  onAddPhase: () => void
  onEditPhase: (phaseId: string) => void
  testId?: string
}) {
  const { t } = useTranslation()

  return (
    <section className="phases-panel" data-testid={testId}>
      <header className="phases-panel-head">
        <h3 className="phases-panel-title">{t('phasesPanel.title')}</h3>
        <span className="phases-panel-aside">{t('phasesPanel.aside')}</span>
      </header>

      <p className="phases-panel-explain" data-testid={`${testId}-explain`}>
        {note ? `${note} ` : ''}
        {t('phasesPanel.explain')}
      </p>

      {phases.map((p) => (
        <div
          className={`phases-row${p.isCurrent ? ' is-current' : ''}`}
          key={p.id}
          data-testid={`${testId}-row-${p.id}`}
        >
          <span className="phases-row-bar" aria-hidden="true" />
          <button
            type="button"
            className="phases-row-name"
            onClick={() => onEditPhase(p.id)}
            data-testid={`${testId}-edit-${p.id}`}
          >
            {p.name}
          </button>
          <span className="phases-row-dates">{p.dates}</span>
        </div>
      ))}

      <button
        type="button"
        className="phases-add"
        onClick={onAddPhase}
        data-testid={`${testId}-add`}
      >
        {t('phasesPanel.add')}
      </button>
    </section>
  )
}
