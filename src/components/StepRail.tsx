import { useTranslation } from 'react-i18next'

/**
 * The numbered step rail across the top of the single-job wizard: a row of pills, each a numbered
 * circle and a label. The current step is on the flow's hue — violet until a kind of brief is
 * chosen, then the template's own colour (SJ-v3, 22 Sep: `--flow-hue` on the wizard) — a done
 * step shows a check on that hue, and a step still ahead is quiet. Read-only — it reports where you are; it is not a nav (you move with
 * Next/Back), which is why the pills are not links.
 *
 * Presentation only: the steps and the current index in, nothing decided.
 */
export function StepRail({
  steps,
  current,
  testId = 'sj',
}: {
  /** In order. `labelKey` is an i18n key. */
  steps: readonly { key: string; labelKey: string }[]
  /** 1-based index of the active step. */
  current: number
  /** The prefix of the rail's testids: `<prefix>-steps`, `<prefix>-step-dot-<n>`. */
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <ol className="step-rail" data-testid={`${testId}-steps`}>
      {steps.map((s, i) => {
        const n = i + 1
        const state = n === current ? 'current' : n < current ? 'done' : 'ahead'
        return (
          <li key={s.key} className={`step-rail-item step-${state} ${state}`} data-testid={`${testId}-step-dot-${n}`}>
            <span className="step-rail-num" aria-hidden="true">
              {state === 'done' ? <Check /> : n}
            </span>
            <span className="step-rail-label">{t(s.labelKey)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
