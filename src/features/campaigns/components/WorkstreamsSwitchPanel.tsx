import { useTranslation } from 'react-i18next'

/**
 * **Workstreams, on or off** — step 1 of the campaign wizard, beside the phases (ADR-0101 d.9,
 * Edward 24 Sep: *"Step 1 adjacent to phases. Default on"*).
 *
 * ADR-0099 made grouping optional — a campaign may have no workstreams — but nothing let a person
 * SAY so, and once the model proposed groups (ADR-0101) every campaign arrived grouped. This is the
 * switch. On: the brief's pieces arrive in named workstreams, each with a department and an owner.
 * Off: the work is one plain list, and each piece's department comes from its owner.
 *
 * It looks and behaves like the Phases switch next to it, on purpose — the same two questions about
 * how a campaign is organised, answered the same way. And like that switch it can be offered and
 * refused: turning it off while pieces sit in workstreams would strand them, so the caller says so
 * (`canToggle`, `toggleHint`) rather than letting the press fail.
 *
 * Presentational (AGENTS.md §4): state in, the press out.
 */
export function WorkstreamsSwitchPanel({
  enabled,
  canToggle = true,
  toggleHint = null,
  onToggle,
  testId = 'workstreams-switch',
}: {
  enabled: boolean
  canToggle?: boolean
  toggleHint?: string | null
  onToggle: (enabled: boolean) => void
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <section className="phases-panel" data-testid={testId}>
      <header className="phases-panel-head">
        <h3 className="phases-panel-title">{t('workstreamsSwitch.title')}</h3>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('workstreamsSwitch.toggleLabel')}
          className="phases-switch"
          disabled={!canToggle}
          title={!canToggle && toggleHint ? toggleHint : undefined}
          onClick={() => onToggle(!enabled)}
          data-testid={`${testId}-toggle`}
        >
          <span className="phases-switch-knob" aria-hidden="true" />
        </button>
      </header>
      <p className="phases-panel-explain" data-testid={`${testId}-explain`}>
        {t(enabled ? 'workstreamsSwitch.onBody' : 'workstreamsSwitch.offBody')}
      </p>
      {!canToggle && toggleHint && (
        <p className="phases-panel-refusal" data-testid={`${testId}-hint`}>{toggleHint}</p>
      )}
    </section>
  )
}
