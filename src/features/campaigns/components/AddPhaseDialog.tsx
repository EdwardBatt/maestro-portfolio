import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { formatPlanDay, phaseStartAfter } from '../../../lib/timing/plan-back'
import { DateField } from '../../../components/DateField'

/**
 * **Add a phase** — Figma `CB-v3-P1`, `I56.10`.
 *
 * A phase is a stretch of the campaign with a start date and an end date (Edward, 24 Sep — the
 * frame's "ends on an event" is gone: an event is not something anybody can define, and a date
 * is). Everything inside the phase plans backwards from its END date (`lib/timing/plan-back.ts`).
 *
 * The start is FILLED from the phase before it — the calendar day after it ends, because Week 4
 * ending Friday 16 October means Week 5 starting Saturday the 17th — and it stays editable, since
 * a season can have a gap. The first phase has nothing before it, so its start is asked for.
 *
 * Presentational (AGENTS.md §4): it collects three values and hands them up. `phaseStartAfter` is
 * the one pure helper it borrows, so the start it fills and the start the wizard would derive
 * cannot differ.
 */
export interface AddPhaseDialogProps {
  /** The phase this one follows — its end fills the new start. Null when this is the first. */
  previousPhase: { name: string; endsOn: string } | null
  /**
   * An existing phase to edit. Absent means adding a new one. It is the same dialog either way —
   * the same three answers — and only the title and the button change.
   */
  initial?: { name: string; startsOn: string; endsOn: string } | null
  onAdd: (phase: { name: string; startsOn: string; endsOn: string }) => void
  /**
   * Drop this phase. Offered only while editing, and only when the caller allows it — a season
   * with one phase left has nothing to remove, and the caller is the one that knows.
   */
  onRemove?: (() => void) | null
  onCancel: () => void
  busy?: boolean
  /** A failure from the caller — a duplicate name, a refusal. Shown on the name field. */
  error?: string | null
  /**
   * The caller's reading of the dates as they are typed (timing step, Edward 24 Sep): a clash with
   * the phase before or after refuses, named; the consequences of saving — the next phase pushed
   * so the two do not overlap, pieces with their own dates moving phase — are said before the
   * press, not discovered after it. Absent where there is nothing around the phase to clash with.
   */
  check?: ((v: { name: string; startsOn: string; endsOn: string }) => { error: string | null; notes: string[] }) | null
  testId?: string
}

export function AddPhaseDialog({
  previousPhase,
  initial = null,
  onAdd,
  onRemove = null,
  onCancel,
  busy = false,
  error = null,
  check = null,
  testId = 'add-phase',
}: AddPhaseDialogProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const editing = initial != null
  const [name, setName] = useState(initial?.name ?? '')
  const [startsOn, setStartsOn] = useState(
    initial?.startsOn || (previousPhase ? phaseStartAfter(previousPhase.endsOn) : ''),
  )
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? '')

  // A phase that ends before it starts is not a tight deadline, it is a typo — said on the field.
  const backwards = Boolean(startsOn && endsOn && endsOn < startsOn)
  const reading = !backwards && startsOn && endsOn && check ? check({ name: name.trim(), startsOn, endsOn }) : null
  const ready = name.trim() !== '' && startsOn !== '' && endsOn !== '' && !backwards && !reading?.error

  function submit() {
    if (!ready) return
    onAdd({ name: name.trim(), startsOn, endsOn })
  }

  return (
    <Modal onClose={onCancel} labelledById={`${testId}-title`} testId={`${testId}-dialog`}>
      <ModalHeader
        id={`${testId}-title`}
        eyebrow={t(editing ? 'timing.editPhase.eyebrow' : 'timing.addPhase.eyebrow')}
        title={t(editing ? 'timing.editPhase.title' : 'timing.addPhase.title')}
        subtitle={t('timing.addPhase.intro')}
      />
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('timing.addPhase.name')} required error={error ?? undefined}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid={`${testId}-name`} />
        </Field>

        <div className="timing-phase-pair">
          <Field
            label={t('timing.addPhase.starts')}
            required
            hint={previousPhase ? t('timing.addPhase.startsAfterHint', { phase: previousPhase.name }) : undefined}
          >
            <DateField
             
              value={startsOn}
              onChange={(v) => setStartsOn(v)}
              data-testid={`${testId}-starts`}
            />
          </Field>
          <Field
            label={t('timing.addPhase.ends')}
            required
            error={backwards ? t('timing.addPhase.beforeStart', { day: formatPlanDay(startsOn, loc) }) : undefined}
          >
            <DateField
             
              value={endsOn}
              min={startsOn || undefined}
              onChange={(v) => setEndsOn(v)}
              data-testid={`${testId}-date`}
            />
          </Field>
        </div>

        {reading?.error && (
          <p className="form-error" role="alert" data-testid={`${testId}-clash`}>{reading.error}</p>
        )}
        {reading && reading.notes.length > 0 && (
          <ul className="timing-consequences" data-testid={`${testId}-consequences`}>
            {reading.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}

        {!editing && <p className="timing-note">{t('timing.addPhase.note')}</p>}
      </form>
      <ModalFooter note={t('timing.addPhase.footnote')}>
        <Button variant="primary" busy={busy} disabled={!ready} onClick={submit} data-testid={`${testId}-submit`}>
          {t(editing ? 'timing.editPhase.submit' : 'timing.addPhase.submit')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
          {t('timing.cancel')}
        </Button>
        {editing && onRemove && (
          <button type="button" className="piece-remove" onClick={onRemove} data-testid={`${testId}-remove`}>
            {t('timing.editPhase.remove')}
          </button>
        )}
      </ModalFooter>
    </Modal>
  )
}
