import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rankPeople, type PickablePerson } from '../lib/people/rank-people'

/**
 * Choose a person by typing their name.
 *
 * Edward, 29 Aug — *"it should work as a smart search instead of having to scroll through every
 * name available."* The brief wizard asks for an owner on every deliverable row, so a `<select>`
 * holding the whole agency is scrolled once per row, on every campaign.
 *
 * **Why this is not a `<datalist>`.** The first version was, and it was the cheap answer: the
 * browser filters for free. But each browser filters differently — Chrome and Firefox match a
 * substring anywhere, so typing "L" also surfaces "Omar **Al**-Rawi" — Safari's support is patchy,
 * the list cannot be styled, results cannot be ranked, and nothing can be shown beside the name.
 * For a control used once per row on every campaign, the match has to be ours.
 *
 * So: **prefix matches first, then substring**, both case-insensitive, and each person carries an
 * optional hint. The wizard passes the department, which is the single most useful thing to see
 * while choosing an owner — ADR-0053 d.1 makes that department the deliverable's Discipline, so
 * the choice being made here is visibly the one that sets it.
 *
 * The VALUE is always an id or empty. Text that matches nobody clears the selection rather than
 * half-selecting, so the form can never submit a person who was never chosen.
 *
 * Presentation only (AGENTS.md §2): it takes a list and gives back an id.
 */

export function PersonPicker({
  people,
  value,
  onChange,
  placeholder,
  disabled = false,
  testId,
}: {
  people: readonly PickablePerson[]
  /** The chosen person's id, or '' for nobody. */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const listId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])

  /** What is in the box while typing. Null means "show the chosen person's name". */
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const shown = draft ?? nameOf.get(value) ?? ''
  // While a person is selected and untouched, the box holds their full name — which would match
  // only them and make the list look broken. An untouched selection therefore offers everyone.
  const matches = useMemo(
    () => rankPeople(people, draft === null ? '' : draft),
    [people, draft],
  )

  // Close when the click lands outside. Registered only while open, so a page full of these does
  // not carry a listener each.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(p: PickablePerson) {
    onChange(p.id)
    setDraft(null)
    setOpen(false)
  }

  /** Leaving the box with text that names nobody selects nobody. Never a half-selection. */
  function commit(text: string) {
    const hit = people.find((p) => p.name.trim().toLowerCase() === text.trim().toLowerCase())
    if (hit) {
      onChange(hit.id)
      setDraft(null)
    } else {
      onChange('')
      // The typed text stays so it can be seen and corrected, rather than vanishing.
      setDraft(text)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (matches.length === 0 ? 0 : (i + delta + matches.length) % matches.length))
      return
    }
    if (e.key === 'Enter' && open) {
      const p = matches[active]
      if (p) { e.preventDefault(); choose(p) }
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setDraft(null)   // back to whoever was chosen; Escape abandons the typing, not the choice.
    }
  }

  return (
    <span className="person-picker" ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active]!.id}` : undefined}
        autoComplete="off"
        value={shown}
        disabled={disabled}
        placeholder={placeholder ?? t('common.searchPeople')}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        // Committing on blur must not race the click that chose somebody, which is why selection
        // happens on mousedown below rather than on click.
        onBlur={(e) => commit(e.target.value)}
        data-testid={testId}
      />

      {open && (
        <ul className="person-picker-list" role="listbox" id={listId} data-testid={testId ? `${testId}-list` : undefined}>
          {matches.length === 0 ? (
            <li className="person-picker-empty" role="presentation" data-testid={testId ? `${testId}-none` : undefined}>
              {t('common.noPeopleMatch')}
            </li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${p.id}`}
                role="option"
                aria-selected={p.id === value}
                className={i === active ? 'is-active' : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(p) }}
                data-testid={testId ? `${testId}-option-${p.id}` : undefined}
              >
                <span className="person-picker-name">{p.name}</span>
                {p.hint && <span className="muted person-picker-hint">{p.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </span>
  )
}

export type { PickablePerson }
