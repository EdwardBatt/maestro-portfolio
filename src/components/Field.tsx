import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag } from './Tag'

/**
 * A labelled form control, in the shape the CS-Flows frames use everywhere: a label with an
 * optional REQUIRED tag on the same line, the control, and a helper line beneath it that becomes
 * the error when the field is flagged. One component so every field on SJ-02/03 and in the modals
 * reads the same and the "REQUIRED / helper / error" rhythm is not re-invented per screen.
 *
 * It renders a real `<label>` wrapping the control (passed as children), so the label is associated
 * without an id dance. Presentation only (AGENTS.md §4): it decides nothing; it shows the required
 * tag (localized, so it reads in Arabic too), the hint, and — when `error` is set — the hint slot
 * in the breach colour.
 *
 *   <Field label={t('…')} required hint={t('…')}>
 *     <input value={v} onChange={…} data-testid="…" />
 *   </Field>
 */
export function Field({
  label,
  required = false,
  /** A caption in place of REQUIRED — e.g. "TYPE THIS" on the SJ-03 empties. Already localized. */
  tag,
  hint,
  /** When set, the hint line shows this in the breach colour instead. */
  error,
  /**
   * `label` (default) wraps a single native control so clicking the label focuses it. Use `div`
   * for a composite control that manages its own labelling — a `PillSelect` radiogroup, a search
   * picker — where a wrapping `<label>` would point at nothing in particular.
   */
  as = 'label',
  children,
}: {
  label: ReactNode
  required?: boolean
  tag?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  as?: 'label' | 'div'
  children: ReactNode
}) {
  const { t } = useTranslation()
  const Wrapper = as
  return (
    <Wrapper className="field">
      <span className="field-head">
        <span className="field-name">{label}</span>
        {required ? <Tag tone="accent">{t('field.required')}</Tag> : tag ? <Tag tone="accent">{tag}</Tag> : null}
      </span>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </Wrapper>
  )
}
