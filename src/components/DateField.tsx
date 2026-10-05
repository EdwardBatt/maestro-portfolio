import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCalendarDay } from '../lib/time/iraq'
import { isRealDay } from '../lib/time/real-day'

/**
 * Every date a person enters (I66.8, Edward 29 Sep). The browser's own calendar box stays — Edward chose that over
 * a calendar of our own — with two things added:
 *
 *  - **The day, in words, beside it** — "Fri, 9 Oct" — because the box itself shows the machine's own format.
 *  - **A mistyped date is caught, never passed on.** A person typed a date on production instead of picking it and
 *    the page crashed ("Invalid time value"): Chrome's year box takes five digits, `20266-10-09` is a valid HTML
 *    date and not a real one, and every screen passed it straight into date arithmetic. Here the parent is only
 *    ever given a real day or `''`, and the person is told what to fix. What they typed stays in the box — it is
 *    theirs to correct, not wiped.
 *
 * `value` / `onChange` carry `YYYY-MM-DD` or `''`, as the native input's did, so a screen swaps in place.
 */
export interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (day: string) => void
  /** The words beside the box; off where the day is already said next to it. */
  showDay?: boolean
}

export function DateField({ value, onChange, showDay = true, className, onBlur, ...rest }: DateFieldProps) {
  const { t, i18n } = useTranslation()
  const [shown, setShown] = useState(value)
  const [wrong, setWrong] = useState(false)
  const emitted = useRef(value)

  // A value set from outside (a reset, a suggestion) replaces what is in the box.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value
      setShown(value)
      setWrong(false)
    }
  }, [value])

  const emit = (day: string) => {
    if (day !== emitted.current) {
      emitted.current = day
      onChange(day)
    }
  }

  const testId = (rest as { 'data-testid'?: string })['data-testid']
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  return (
    <span className="date-field">
      <input
        {...rest}
        type="date"
        className={className}
        value={shown}
        aria-invalid={wrong || rest['aria-invalid'] || undefined}
        onChange={(e) => {
          const raw = e.target.value
          setShown(raw)
          if (raw === '') {
            // Empty, or a day the browser itself cannot read (31 February, half typed): nothing to pass on. Said on blur.
            emit('')
            if (!e.target.validity.badInput) setWrong(false)
            return
          }
          const ok = isRealDay(raw)
          setWrong(!ok)
          emit(ok ? raw : '')
        }}
        onBlur={(e) => {
          if (e.target.validity.badInput) setWrong(true)
          onBlur?.(e)
        }}
      />
      {showDay && !wrong && isRealDay(shown) && (
        <span className="date-field-day" data-testid={testId ? `${testId}-day` : undefined}>{formatCalendarDay(shown, loc)}</span>
      )}
      {wrong && (
        <span className="field-error" role="alert" data-testid={testId ? `${testId}-wrong` : undefined}>{t('dateField.wrong')}</span>
      )}
    </span>
  )
}
