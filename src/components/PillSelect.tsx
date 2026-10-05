import type { ReactNode } from 'react'

/**
 * A single-select rendered as a row of pills — the "Assigned to" department picker on SJ-02, where
 * the frame shows Creative / Production / Audio / Copy / Social as chips with the chosen one
 * filled violet. A pill row (not a dropdown) because there are few options and the choice drives
 * the whole next screen, so it should be visible, not folded away.
 *
 * Presentation only: the options, the value and an onChange in. Keyboard-operable — each pill is a
 * button; arrow keys are the browser's tab order, which is enough for a short row.
 */
export function PillSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  invalid = false,
  testId,
}: {
  options: readonly { value: T; label: ReactNode }[]
  value: T | ''
  onChange: (value: T) => void
  ariaLabel?: string
  invalid?: boolean
  testId?: string
}) {
  return (
    <div
      className="pill-select"
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      data-testid={testId}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`pill${selected ? ' pill-on' : ''}`}
            onClick={() => onChange(o.value)}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
