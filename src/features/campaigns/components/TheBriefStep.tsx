import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { FillerWarning } from '../../../components/FillerWarning'

/**
 * **The brief** — step 2 of the campaign wizard (Figma `CB-v3-02`, `I56.5`).
 *
 * *"The Creative Brief, in four parts."* The frame's whole argument is in its lede: a long brief is
 * **one page you scroll**, not seventeen screens. So the parts are stacked cards on a single
 * surface and the numbered rail on the inline-start is a map, not a wizard inside a wizard —
 * pressing a part scrolls to it, it never hides the rest. That distinction is the screen: an
 * account manager transcribing a client's brief needs to see what is still empty while typing, and
 * a step-per-part would hide exactly that.
 *
 * **The bilingual label is structural, not decoration.** Every field carries its Arabic label
 * beside the English one ("Background الخلفية") in both locales, because the people filling this in
 * write the brief in one language and the client reads it in the other — the pair *is* the field
 * name. The row is flex with logical gaps, so under `dir=rtl` the Arabic leads and the English
 * follows without a second rule.
 *
 * **Counts are derived, never passed.** The rail's "3 of 3" and the card's "3 OF 3" are computed
 * from the fields actually rendered. A caller-supplied count is a second source of truth that goes
 * stale the moment someone types, and "why does it say 2 of 3 when they are all full?" is not a
 * question worth being able to ask.
 *
 * Presentational (AGENTS.md §4): fields and rules in, changes out. It does not know what a mutation
 * or a query is. The drop zone above the parts is the CALLER's (`top`): until 24 Sep this screen
 * drew its own, handed the file to a callback nobody implemented, and the working reader sat in a
 * second panel beside it. One drop zone now, and it is the one that reads.
 */
export interface BriefField {
  key: string
  /** "Background" — the English label. */
  labelEn: string
  /** "الخلفية" — shown beside it, in both locales. Null only where no Arabic label exists yet. */
  labelAr: string | null
  value: string
  placeholder: string
  /** A paragraph rather than a line — Background and the idea run long; the task does not. */
  multiline?: boolean
  /**
   * Two fields share a row, as the frame pairs the functional and emotional benefits. A lone
   * half-width field simply takes the row, so this never has to be set in pairs to be safe.
   */
  halfWidth?: boolean
  /**
   * The one field a brief cannot proceed without. The frame marks nothing REQUIRED, because
   * the frame's brief is already written; a real one is refused on Next and the person has to
   * be able to see WHICH box the refusal means without reading it twice.
   */
  required?: boolean
  /** Said on the box when the step was refused for this field. Cleared as soon as it is filled. */
  error?: string | null
  /**
   * Filled from an uploaded brief and not yet reviewed (ADR-0044 §5). Marked ON the field, with its
   * own Keep beside it (Edward, 24 Sep) — not in a strip at the top of the page, where the answer
   * and the thing it answers are a screen apart. Keep it or edit it; either clears the mark.
   */
  suggested?: boolean
}

export interface BriefPart {
  key: string
  /** "1" … "5" — the rail and the card head both lead with it. */
  number: string
  /** "Context", "Audience and brand" — the Creative Brief's own headings, already localized. */
  name: string
  fields: BriefField[]
  /**
   * "5 · Dos and don'ts" — its body is the rule list, not fields, and the rail counts rules rather
   * than filled boxes. Flagged rather than special-cased by key so the parts stay one ordered list
   * in both the rail and the stack.
   */
  isRules?: boolean
}

export interface BriefRule {
  id: string
  kind: 'do' | 'dont'
  text: string
  /** The Arabic wording where the rule has one; many rules quote both scripts in `text` itself. */
  textAr: string | null
  /**
   * The client's rules sit locked underneath (the frame's chip). ADR-0098's shape: a campaign rule
   * can sit on top of a client's, it can never cancel one — so a locked rule offers no remove at
   * all, rather than a remove that fails.
   */
  locked: boolean
  from: 'client' | 'campaign'
}

export function TheBriefStep({
  parts,
  rules,
  onFieldChange,
  onAddRule,
  onRemoveRule,
  onKeepField,
  top = null,
  bottom = null,
  note = null,
  fillerWords = [],
  testId = 'brief',
}: {
  parts: BriefPart[]
  rules: BriefRule[]
  onFieldChange: (partKey: string, fieldKey: string, value: string) => void
  onAddRule: () => void
  onRemoveRule: (id: string) => void
  /** "Keep" on a suggested field: the value is the person's now, and the mark comes off. */
  onKeepField?: (fieldKey: string) => void
  /** Above the parts: the caller's "Got a brief already? Drop it here", which reads the file. */
  top?: ReactNode
  /** Cards after the brief's own parts — the campaign's Languages (ADR-0117). */
  bottom?: ReactNode
  /** The line under the last part — "Budget is on the template and not shown." — or nothing. */
  note?: string | null
  /** ADR-0111 d.3 / E10 (I59.27): the tenant's own filler words, on top of the built-ins. Every field
   *  with text is checked and warned beside; the database refuses at approval. */
  fillerWords?: readonly string[]
  testId?: string
}) {
  const { t } = useTranslation()
  const cards = useRef<Record<string, HTMLElement | null>>({})
  // Which part the rail marks as current. It follows the cursor as well as the rail, because the
  // rail is a map of where you are — and where you are is the box you are typing in.
  const [current, setCurrent] = useState<string>(parts[0]?.key ?? '')

  const filledIn = (p: BriefPart) => p.fields.filter((f) => f.value.trim() !== '').length

  const clientRules = rules.filter((r) => r.from === 'client').length
  const campaignRules = rules.length - clientRules

  const go = (key: string) => {
    setCurrent(key)
    // The glide is the only motion on this screen, and it carries state — it shows you where the
    // part sits relative to the one you were in. Someone who has asked for less motion gets the
    // jump instead, which still lands in the same place.
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    cards.current[key]?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="brief-step" data-testid={testId}>
      <h2 className="brief-step-title">{t('brief.title')}</h2>
      <p className="brief-step-lede">{t('brief.lede')}</p>

      <div className="brief-step-body">
        <nav className="brief-rail" aria-label={t('brief.railLabel')} data-testid={`${testId}-rail`}>
          {parts.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`brief-rail-row${p.key === current ? ' is-current' : ''}`}
              aria-current={p.key === current ? 'true' : undefined}
              onClick={() => go(p.key)}
              data-testid={`${testId}-rail-${p.key}`}
            >
              <span className="brief-rail-name">
                {p.number} · {p.name}
              </span>
              <span className="brief-rail-count" data-testid={`${testId}-rail-count-${p.key}`}>
                {p.isRules
                  ? t('brief.ruleCount', { count: rules.length })
                  : t('brief.partCount', { filled: filledIn(p), total: p.fields.length })}
              </span>
            </button>
          ))}
          {/* The rail's last row names where this is going without pretending to be a part of the
              brief — it is the next step, so it is a caption, not a button. */}
          <span className="brief-rail-row is-ahead" data-testid={`${testId}-rail-next`}>
            <span className="brief-rail-name">{t('brief.nextStep')}</span>
            <span className="brief-rail-count">{t('brief.nextStepHint')}</span>
          </span>
        </nav>

        <div className="brief-stack">
          {top}

          {parts.map((p) => {
            const filled = filledIn(p)
            const done = !p.isRules && p.fields.length > 0 && filled === p.fields.length
            return (
              <section
                key={p.key}
                ref={(el) => {
                  cards.current[p.key] = el
                }}
                className={`brief-card${done ? ' is-done' : ''}`}
                aria-labelledby={`${testId}-head-${p.key}`}
                data-testid={`${testId}-card-${p.key}`}
              >
                <header className="brief-card-head">
                  <h3 id={`${testId}-head-${p.key}`} className="brief-card-name">
                    {p.number} · {p.name}
                  </h3>
                  <span
                    className={`brief-card-chip${done ? ' is-done' : ''}`}
                    data-testid={`${testId}-chip-${p.key}`}
                  >
                    {p.isRules
                      ? [
                          t('brief.ruleCountChip', { count: campaignRules }),
                          clientRules > 0 ? t('brief.clientLocked', { count: clientRules }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t('brief.partCountChip', { filled, total: p.fields.length })}
                  </span>
                  {p.isRules && (
                    <>
                      <span className="brief-card-gap" />
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="plus"
                        onClick={onAddRule}
                        data-testid={`${testId}-add-rule`}
                      >
                        {t('brief.addRule')}
                      </Button>
                    </>
                  )}
                </header>

                {p.isRules ? (
                  <ul className="brief-rules">
                    {rules.map((r) => (
                      <li key={r.id} className="brief-rule" data-testid={`${testId}-rule-${r.id}`}>
                        <span className={`brief-rule-kind is-${r.kind}`}>
                          {t(r.kind === 'do' ? 'brief.do' : 'brief.dont')}
                        </span>
                        {/* `dir=auto` on the rule text: these lines quote Arabic inside an English
                            sentence ("Never قرعة, never 'lottery'"), and the wrong base direction
                            moves the punctuation to the wrong end of the line. */}
                        <span className="brief-rule-text" dir="auto">
                          {r.text}
                          {r.textAr ? (
                            <span className="brief-rule-ar" dir="auto">
                              {r.textAr}
                            </span>
                          ) : null}
                        </span>
                        {r.locked ? (
                          /* No remove at all, not a disabled one: a client rule is not this
                             campaign's to cancel, and a greyed bin invites the press anyway. */
                          <span
                            className="brief-rule-locked"
                            title={t('brief.lockedRule')}
                            data-testid={`${testId}-rule-locked-${r.id}`}
                          >
                            {t('brief.lockedBy', { source: t(`brief.source.${r.from}`) })}
                          </span>
                        ) : (
                          <IconButton
                            icon="trash"
                            size="sm"
                            danger
                            label={t('brief.removeRule')}
                            onClick={() => onRemoveRule(r.id)}
                            data-testid={`${testId}-rule-remove-${r.id}`}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="brief-step-fields">
                    {p.fields.map((f) => {
                      const isFilled = f.value.trim() !== ''
                      // Keyed by the FIELD alone: a field key is unique across the brief, and
                      // putting the part in it would make every caller carry a field-to-part map.
                      const id = `${testId}-${f.key}`
                      return (
                        <div
                          key={f.key}
                          className={`brief-step-field${f.halfWidth ? ' is-half' : ''}${f.suggested ? ' is-suggested' : ''}`}
                        >
                          <div className="brief-step-field-top">
                            <label className="brief-step-field-head" htmlFor={id}>
                              <span className="brief-step-field-en">{f.labelEn}</span>
                              {f.required && <span className="req-chip">{t('piece.required')}</span>}
                              {f.labelAr ? (
                                <span className="brief-step-field-ar" dir="auto">
                                  {f.labelAr}
                                </span>
                              ) : null}
                            </label>
                            {f.suggested && (
                              <span className="brief-step-suggested" data-testid={`${id}-suggested`}>
                                <span className="brief-step-suggested-from">{t('campaigns.ingest.marker')}</span>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon="check"
                                  onClick={() => onKeepField?.(f.key)}
                                  data-testid={`${id}-keep`}
                                >
                                  {t('campaigns.ingest.confirm')}
                                </Button>
                              </span>
                            )}
                          </div>
                          {f.multiline ? (
                            <textarea
                              id={id}
                              className="brief-input"
                              rows={3}
                              value={f.value}
                              placeholder={f.placeholder}
                              dir="auto"
                              aria-invalid={f.error ? true : undefined}
                              data-filled={isFilled ? 'true' : 'false'}
                              onFocus={() => setCurrent(p.key)}
                              onChange={(e) => onFieldChange(p.key, f.key, e.target.value)}
                              data-testid={id}
                            />
                          ) : (
                            <input
                              id={id}
                              className="brief-input"
                              type="text"
                              value={f.value}
                              placeholder={f.placeholder}
                              dir="auto"
                              aria-invalid={f.error ? true : undefined}
                              data-filled={isFilled ? 'true' : 'false'}
                              onFocus={() => setCurrent(p.key)}
                              onChange={(e) => onFieldChange(p.key, f.key, e.target.value)}
                              data-testid={id}
                            />
                          )}
                          {f.error && (
                            <span className="field-error" data-testid={`${id}-missing`}>{f.error}</span>
                          )}
                          <FillerWarning text={f.value} extraWords={fillerWords} testId={`${id}-filler`} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}

          {bottom}

          {note && <p className="brief-step-note" data-testid={`${testId}-note`}>{note}</p>}
        </div>
      </div>
    </div>
  )
}
