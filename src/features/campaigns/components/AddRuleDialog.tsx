import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { Field } from '../../../components/Field'
import { Button } from '../../../components/Button'

/**
 * **Add a do or a don't** — the modal behind "+ Add a rule" on the brief step (Figma `CB-v3-P2`,
 * `I56.6`).
 *
 * The screen it opens over already says what a rule is *for*; this says what a rule *cannot do*.
 * A campaign rule sits on top of the client's and can never cancel one (ADR-0098's shape, and the
 * frame's own line), so the modal states that twice on purpose — once in the subtitle before you
 * type, once in violet above the button as you commit. Nowhere does it offer a control to override
 * a client rule, because there is no such thing to offer.
 *
 * **Don't is red and Do is green.** That looks like the reserved status palette and is not: green
 * and red here name a *kind of instruction*, which is exactly how a copywriter reads a list of dos
 * and don'ts, and the pair is dead on the page — no amber, no glow, nothing animated. The DO chip
 * takes `--hue-1`, a hue token rather than `--status-ok`, so the reservation in the design skill
 * ("status colors are reserved exclusively for state") stays intact.
 *
 * **"Applies in" is a multi-select**, so it is a group of toggles rather than `PillSelect`, which
 * is single-choice by contract. A rule that holds in Arabic but not English is the common case —
 * the LUMA wording rules are all of that kind — so all languages start on and you turn one off.
 *
 * Presentational (AGENTS.md §4): it collects a rule and hands it up. It never writes.
 */
export interface NewRule {
  kind: 'do' | 'dont'
  text: string
  /** The languages it holds in. Never empty — the form will not submit an empty set. */
  locales: string[]
  /** "Because" — who said so, and when. Optional, and the frame says why it should not be. */
  because: string
}

export interface RuleLocale {
  value: string
  /** Already localized — the campaign's languages are the campaign's, not this dialog's. */
  label: string
}

export function AddRuleDialog({
  locales,
  onAdd,
  onCancel,
  testId = 'add-rule',
}: {
  locales: readonly RuleLocale[]
  onAdd: (rule: NewRule) => void
  onCancel: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<'do' | 'dont'>('do')
  const [text, setText] = useState('')
  const [because, setBecause] = useState('')
  // Every language on by default: the frame shows all three lit, and a rule about wording almost
  // always holds everywhere. Turning one off is the deliberate act; ticking three is not.
  const [picked, setPicked] = useState<string[]>(() => locales.map((l) => l.value))

  const toggle = (value: string) =>
    setPicked((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )

  const ready = text.trim() !== '' && picked.length > 0

  const submit = () => {
    if (!ready) return
    onAdd({ kind, text: text.trim(), locales: picked, because: because.trim() })
  }

  const kinds = [
    { value: 'do' as const, label: t('brief.rule.do') },
    { value: 'dont' as const, label: t('brief.rule.dont') },
  ]

  return (
    <Modal onClose={onCancel} labelledById={`${testId}-title`} testId={testId}>
      <ModalHeader
        id={`${testId}-title`}
        eyebrow={t('brief.rule.eyebrow')}
        title={t('brief.rule.title')}
        subtitle={t('brief.rule.intro')}
      />
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div
          className="brief-kind-select"
          role="radiogroup"
          aria-label={t('brief.rule.kindLabel')}
          data-testid={`${testId}-kind`}
        >
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              className={`brief-kind${kind === k.value ? ` is-on is-${k.value}` : ''}`}
              onClick={() => setKind(k.value)}
              data-testid={`${testId}-kind-${k.value}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <Field label={t('brief.rule.text')} required>
          {/* `dir=auto` because these lines quote both scripts at once — the LUMA rules read
              "Never 'lottery'. Never قرعة." and the base direction decides where the full stop
              lands. */}
          <input
            autoFocus
            type="text"
            dir="auto"
            value={text}
            placeholder={t('brief.rule.textPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            data-testid={`${testId}-text`}
          />
        </Field>

        <div className="dialog-row">
          <Field as="div" label={t('brief.rule.appliesIn')}>
            <div
              className="brief-locale-select"
              role="group"
              aria-label={t('brief.rule.appliesIn')}
              data-testid={`${testId}-locales`}
            >
              {locales.map((l) => {
                const on = picked.includes(l.value)
                return (
                  <button
                    key={l.value}
                    type="button"
                    aria-pressed={on}
                    className={`brief-locale${on ? ' is-on' : ''}`}
                    onClick={() => toggle(l.value)}
                    data-testid={`${testId}-locale-${l.value}`}
                  >
                    {l.label}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={t('brief.rule.because')} hint={t('brief.rule.becauseHint')}>
            <input
              type="text"
              dir="auto"
              value={because}
              placeholder={t('brief.rule.becausePlaceholder')}
              onChange={(e) => setBecause(e.target.value)}
              data-testid={`${testId}-because`}
            />
          </Field>
        </div>

        {/* Said again, at the point of commitment: what you are adding does not outrank the
            client. The frame sets this in violet rather than amber — it is how the thing works,
            not a warning about it. */}
        <p className="brief-rule-note">{t('brief.rule.lockedNote')}</p>
      </form>
      <ModalFooter>
        <Button
          type="button"
          variant="primary"
          disabled={!ready}
          onClick={submit}
          data-testid={`${testId}-submit`}
        >
          {t('brief.rule.submit')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
          {t('schedule.cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
