import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from './Button'

/**
 * **Languages** — the languages a campaign or single job is made in (ADR-0117 d.1, Edward 27 Sep).
 *
 * A smart filter: type and the list narrows; pick one (click, or Enter on the highlighted one) and it
 * joins the chosen list above, each with a remove icon. What is typed and is not on the list can be
 * added with **Add language** — the caller adds it to the tenant's list (`add_language`) and the new
 * code is chosen at once.
 *
 * Presentational (AGENTS.md §4): the list, the choice and the add all come from and go back to the
 * caller.
 */
export interface LanguageOption {
  code: string
  label: string
}

export function LanguagePicker({
  options,
  value,
  onChange,
  onAdd,
  adding = false,
  testId = 'languages',
}: {
  options: readonly LanguageOption[]
  /** The chosen codes, in the order chosen. */
  value: readonly string[]
  onChange: (codes: string[]) => void
  /** Add a language the list does not have; resolves to its code. */
  onAdd: (label: string) => Promise<string>
  adding?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const labelOf = useMemo(() => new Map(options.map((o) => [o.code, o.label])), [options])
  const q = text.trim().toLowerCase()
  const matches = useMemo(
    () => options.filter((o) => !value.includes(o.code) && (q === '' || o.label.toLowerCase().includes(q))),
    [options, value, q],
  )
  // "Add language" only for a name the list does not already have (chosen or not).
  const canAdd = q !== '' && !options.some((o) => o.label.trim().toLowerCase() === q)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(code: string) {
    if (!value.includes(code)) onChange([...value, code])
    setText('')
    setActive(0)
  }

  async function addTyped() {
    const label = text.trim()
    if (!label) return
    const code = await onAdd(label)
    choose(code)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (matches.length === 0 ? 0 : (i + d + matches.length) % matches.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = matches[active]
      if (hit) choose(hit.code)
      else if (canAdd) void addTyped()
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setText('')
    }
  }

  return (
    <div className="language-picker" ref={rootRef} data-testid={testId}>
      {value.length > 0 && (
        <ul className="language-chips" data-testid={`${testId}-chosen`}>
          {value.map((code) => (
            <li key={code} className="language-chip" data-testid={`${testId}-chip-${code}`}>
              <span>{labelOf.get(code) ?? code.toUpperCase()}</span>
              <IconButton
                icon="close"
                size="sm"
                label={t('languages.remove', { language: labelOf.get(code) ?? code })}
                onClick={() => onChange(value.filter((c) => c !== code))}
                data-testid={`${testId}-remove-${code}`}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="language-picker-row">
        <span className="person-picker">
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={text}
            placeholder={t('languages.placeholder')}
            onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            aria-label={t('languages.title')}
            data-testid={`${testId}-input`}
          />
          {open && (
            <ul className="person-picker-list" role="listbox" id={listId} data-testid={`${testId}-list`}>
              {matches.length === 0 ? (
                <li className="person-picker-empty" role="presentation">
                  {canAdd ? t('languages.notListed', { name: text.trim() }) : t('languages.allChosen')}
                </li>
              ) : (
                matches.map((o, i) => (
                  <li
                    key={o.code}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'is-active' : undefined}
                    onMouseDown={(e) => { e.preventDefault(); choose(o.code) }}
                    data-testid={`${testId}-option-${o.code}`}
                  >
                    {o.label}
                  </li>
                ))
              )}
            </ul>
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          busy={adding}
          disabled={!canAdd || adding}
          onClick={() => void addTyped()}
          data-testid={`${testId}-add`}
        >
          {t('languages.add')}
        </Button>
      </div>
    </div>
  )
}
