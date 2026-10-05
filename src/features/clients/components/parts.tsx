import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import arrow from '../assets/arrow.svg'
import { STEPS } from '../lib/client-profile'

/**
 * The pieces every frame of Figma section J repeats (ADR-0123 d.8): the stepper, the profile meter, a
 * chip, a card, a field's label, the footer. Sizes and colours are in `index.css` under `.cl-*`.
 */

export type ChipTone = 'purple' | 'neutral' | 'amber' | 'ok' | 'risk' | 'violet' | 'off'

export function Chip({ tone, size, children, testId }: { tone: ChipTone; size?: 7 | 8 | 9; children: ReactNode; testId?: string }) {
  return (
    <span className={`cl-chip tone-${tone}${size ? ` is-${size}` : ''}`} data-testid={testId}>
      {children}
    </span>
  )
}

export function Stepper({ current, done, onGo }: { current: number; done: (step: number) => boolean; onGo: ((step: number) => void) | null }) {
  const { t } = useTranslation()
  return (
    <nav className="cl-stepper" aria-label={t('clients.wizard.steps')} data-testid="client-stepper">
      {STEPS.map((key, i) => {
        const n = i + 1
        const isCurrent = n === current
        const isDone = !isCurrent && done(n)
        return (
          <button
            key={key}
            type="button"
            className={`cl-step${isCurrent ? ' is-current' : isDone ? ' is-done' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
            disabled={!onGo || isCurrent}
            onClick={() => onGo?.(n)}
            data-testid={`client-step-${n}`}
          >
            <span className="cl-step-dot" aria-hidden="true">{isDone ? '✓' : n}</span>
            {t(`clients.wizard.step.${key}`)}
          </button>
        )
      })}
    </nav>
  )
}

export function Gauge({ pct, active = false }: { pct: number; active?: boolean }) {
  const { t } = useTranslation()
  const ready = pct >= 100
  return (
    <div className={`cl-gauge${ready ? ' is-ready' : ''}`} data-testid="client-gauge">
      <div className="cl-gauge-head">
        <span className="cl-gauge-label">{t('clients.wizard.profile')}</span>
        <span className="cl-gauge-pct" data-testid="client-gauge-pct">{pct}%</span>
      </div>
      <div className="cl-gauge-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('clients.wizard.profile')}>
        <div className="cl-gauge-fill" style={{ inlineSize: `${pct}%` }} />
      </div>
      {/* I69.2: an active client is past activation — its gauge says how complete the profile is, not "ready to activate". */}
      <span className="cl-gauge-note">{t(active ? (ready ? 'clients.wizard.complete' : 'clients.wizard.fuller') : ready ? 'clients.wizard.ready' : 'clients.wizard.fuller')}</span>
    </div>
  )
}

export function Card({ title, chip, count, children, testId }: { title: ReactNode; chip?: ReactNode; count?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="cl-card" data-testid={testId}>
      <div className="cl-card-head">
        <h2 className="cl-card-title">{title}</h2>
        {chip}
        {count != null && <span className="cl-card-count">{count}</span>}
      </div>
      {children}
    </section>
  )
}

export function FieldLabel({ label, required, htmlFor }: { label: string; required?: boolean; htmlFor?: string }) {
  const { t } = useTranslation()
  return (
    <div className="cl-label-row">
      <label className="cl-label" htmlFor={htmlFor}>{label}</label>
      {required && <Chip tone="purple" size={8}>{t('clients.wizard.required')}</Chip>}
    </div>
  )
}

export function NextButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <button type="button" className="cl-next" onClick={onClick} disabled={disabled} data-testid={testId}>
      {label}
      <img className="cl-next-arrow" src={arrow} width={8.66} height={6.75} alt="" />
    </button>
  )
}

export function Footer({ children, hint }: { children: ReactNode; hint: ReactNode }) {
  return (
    <div className="cl-foot">
      {children}
      <p className="cl-foot-hint">{hint}</p>
    </div>
  )
}

/** A field that looks like the frames' box ("Mobile app · Services") and opens a list of checkboxes. */
export function MultiSelect<T extends string>({
  id, values, options, onChange, placeholder, testId,
}: {
  id: string
  values: readonly T[]
  options: readonly { value: T; label: string }[]
  onChange: (next: T[]) => void
  placeholder: string
  testId: string
}) {
  const shown = options.filter((o) => values.includes(o.value)).map((o) => o.label).join(' · ')
  return (
    <details className="cl-multi" data-testid={testId}>
      <summary id={id} className={`cl-input${shown ? '' : ' is-empty'}`}>{shown || placeholder}</summary>
      <div className="cl-menu">
        {options.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              checked={values.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...values, o.value] : values.filter((v) => v !== o.value))}
              data-testid={`${testId}-${o.value}`}
            />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  )
}
