import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { groupByCategory, rankDeliverables, type PickableDeliverable } from '../lib/deliverables/rank-deliverables'

/**
 * Choose one of the catalogue's deliverables by typing (ADR-0097 d.7, I53.3).
 *
 * Edward, 20 Sep: *"any field for selecting a deliverable should be a searchable drop down"*, and
 * *"why are we picking type? If we pick a deliverable a type is already mapped"* — the 260 catalogue
 * rows ARE the deliverables as the team names them, each with its task list mapped. So the field is
 * labelled **Deliverable**, never *Type*, and this replaces the plain `<select>` of 260 rows in the
 * wizard, in *Add / edit deliverable*, and anywhere else one is chosen.
 *
 * The shape is `PersonPicker`'s: prefix matches first, then substring, then by category; the list
 * is grouped by category because twelve names are shared across categories (ADR-0054) and the
 * group is what tells a Reel under SOCIAL from one under VIDEO. The VALUE is always an id or empty;
 * text that names nothing clears the choice rather than half-selecting. Presentation only.
 */
export function DeliverablePicker({
  items,
  value,
  onChange,
  placeholder,
  disabled = false,
  autoFocus = false,
  testId,
}: {
  items: readonly PickableDeliverable[]
  /** The chosen catalogue row's id, or '' for none. */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const listId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)

  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])

  /** What is in the box while typing. Null means "show the chosen deliverable's name". */
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const chosen = byId.get(value) ?? null
  const shown = draft ?? chosen?.name ?? ''
  // An untouched selection offers the whole catalogue, not just the one row that matches its name.
  const matches = useMemo(() => rankDeliverables(items, draft === null ? '' : draft), [items, draft])
  const groups = useMemo(() => groupByCategory(matches), [matches])
  // The flat order the keyboard walks — the groups, in order, so ArrowDown follows what is drawn.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(it: PickableDeliverable) {
    onChange(it.id)
    setDraft(null)
    setOpen(false)
  }

  /** Leaving the box with text that names nothing selects nothing. A code typed whole selects. */
  function commit(text: string) {
    // Untouched: the box holds the chosen entry's name, and twelve names are shared across
    // categories (ADR-0054) — re-resolving "Social Advertisement" by name on a mere blur would
    // silently swap ADV-003 for SOC-009. Nothing was typed, so nothing changes.
    if (draft === null) return
    const q = text.trim().toLowerCase()
    const sameName = (it: PickableDeliverable) => it.name.toLowerCase() === q || (it.nameAlt ?? '').toLowerCase() === q
    const hit =
      items.find((it) => it.code.toLowerCase() === q) ??
      (chosen && sameName(chosen) ? chosen : items.find(sameName))
    if (hit) {
      onChange(hit.id)
      setDraft(null)
    } else if (q === '') {
      onChange('')
      setDraft(null)
    } else {
      onChange('')
      setDraft(text)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (flat.length === 0 ? 0 : (i + delta + flat.length) % flat.length))
      return
    }
    if (e.key === 'Enter' && open) {
      const it = flat[active]
      if (it) { e.preventDefault(); choose(it) }
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setDraft(null)
    }
  }

  let index = -1
  return (
    <span className="person-picker deliverable-picker" ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${listId}-${flat[active]!.id}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={shown}
        disabled={disabled}
        placeholder={placeholder ?? t('common.searchDeliverables')}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setActive(0) }}
        // Opens on a click or a keystroke, NOT on focus: a dialog lands focus on its first control,
        // and a 260-row list dropping open over the Save button on every open is not a search.
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={(e) => commit(e.target.value)}
        data-testid={testId}
      />
      {chosen && draft === null && (
        <span className="deliverable-picker-chip muted" data-testid={testId ? `${testId}-chip` : undefined}>
          {chosen.code} · {chosen.category}
        </span>
      )}

      {open && (
        <ul className="person-picker-list deliverable-picker-list" role="listbox" id={listId} data-testid={testId ? `${testId}-list` : undefined}>
          {flat.length === 0 ? (
            <li className="person-picker-empty" role="presentation" data-testid={testId ? `${testId}-none` : undefined}>
              {t('common.noDeliverablesMatch')}
            </li>
          ) : (
            groups.map((g) => (
              <li key={g.category} role="presentation" className="deliverable-picker-group">
                <span className="deliverable-picker-category muted">{g.category}</span>
                <ul role="group" aria-label={g.category}>
                  {g.items.map((it) => {
                    index += 1
                    const i = index
                    return (
                      <li
                        key={it.id}
                        id={`${listId}-${it.id}`}
                        role="option"
                        aria-selected={it.id === value}
                        className={i === active ? 'is-active' : undefined}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => { e.preventDefault(); choose(it) }}
                        data-testid={testId ? `${testId}-option-${it.id}` : undefined}
                      >
                        <span className="person-picker-name">{it.name}</span>
                        <span className="muted person-picker-hint">{it.code}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      )}
    </span>
  )
}

export type { PickableDeliverable }
