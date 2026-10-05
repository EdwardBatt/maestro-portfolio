import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { TaskPreview } from './TaskPreview'

/**
 * Add or edit one piece of work (Figma `CB-v3-P4` and `CB-v3-P8`, `I56.8`/`I56.7`).
 *
 * **One component, two modes**, because the frames are the same dialog with three differences: the
 * eyebrow, the title, and the buttons. `P8` adds *Remove this piece* and says the thing that makes
 * the whole screen make sense —
 *
 *   *"Before the campaign is approved, any change is just an edit. After, it becomes a change
 *    request the team lead has to accept."*
 *
 * — which is `I56.3`'s Q13, and the reason nothing here asks for a reason. Reasons belong to
 * removal (`P6`) and to change requests, which are not in this section.
 *
 * **Four fields the frames do not draw** (Edward, 23 Sep). The frames are a proposal, and on this
 * dialog they are short of what a campaign actually has to carry:
 *
 *  - **the deliverable type**, from the catalogue. This is the load-bearing one: a type brings its
 *    own default task list (`deliverable_types.default_workflow_template_id`) and its own lead time
 *    (`lead_time_hours`), so a piece without one is a piece the system cannot plan or staff. The
 *    proposal picks it from the catalogue, so it normally arrives already chosen;
 *  - **quantity** — three sizes of the same key visual is one piece with a quantity, not three
 *    pieces. Distinct from several languages, which the frame's own footnote makes several pieces;
 *  - **the owner**, required. The account manager names somebody when she sets the campaign up,
 *    and the deliverable owner approving the task list (ADR-0100) is that person;
 *  - **notes** — the account manager's own aside, free text. Not the brief's words about the row
 *    (ADR-0097 d.2), which are evidence and are never overwritten by a person.
 *
 * **The workstream is shown and not chosen.** It is fixed by where the person clicked, and the
 * caption under it says what that decides: *sets the department: Creative* (ADR-0099 d.3). Moving
 * a piece between groups is a separate act, not a dropdown buried in a form.
 *
 * **Languages are pills and they are not a property of one piece.** `I56.7` holds one language per
 * deliverable, and the frame's own footnote says why — *"Kurdish: its own owner and status."* So
 * picking three languages makes three pieces, and the dialog says so in a line rather than
 * pretending one row can be three things.
 *
 * Presentational: it holds a draft and hands it back. It does not know what a mutation is.
 */
export interface PieceDraft {
  name: string
  idea: string
  /** The account manager's own aside. Free text, optional, and never the brief's own words. */
  notes: string
  phaseId: string | null
  /** The catalogue type. It carries the default task list and the lead time. */
  deliverableTypeId: string | null
  format: string | null
  /** The platform it goes out on — Instagram, TikTok, TV. Stored as the `channel` attribute. */
  channel: string | null
  priority: 'high' | 'medium' | 'low' | null
  quantity: number
  /** Required before the piece can be saved (Edward, 22 and 23 Sep). */
  ownerUserId: string | null
  /** Language codes from the tenant's list. Several means several pieces — see above. */
  languages: string[]
}

export interface PieceDialogOption {
  id: string
  label: string
}

export function PieceDialog({
  mode,
  workstreamName,
  showWorkstream = true,
  departmentName,
  initial,
  phases,
  types,
  formats,
  channels,
  owners,
  taskPreview = null,
  languages,
  /** The line the frame prints under the fields: when it is due, and who answers for it. */
  plannedLine,
  onSave,
  onSaveAndAddAnother,
  onRemove,
  onCancel,
  busy = false,
  testId = 'piece',
}: {
  mode: 'add' | 'edit'
  workstreamName: string
  /** ADR-0101 d.9: false when the campaign does not use workstreams — no workstream field, no "to X" in the title. */
  showWorkstream?: boolean
  departmentName: string
  initial?: Partial<PieceDraft>
  phases: PieceDialogOption[]
  types: PieceDialogOption[]
  formats: PieceDialogOption[]
  channels: PieceDialogOption[]
  owners: PieceDialogOption[]
  /**
   * The task list the chosen type brings (ADR-0052). Returns null where the type has none.
   * It lives here rather than on the row because this is where the type is chosen, and the
   * tasks are the consequence of that choice — seeing them after the dialog closes is too late.
   */
  taskPreview?: ((typeId: string | null) => string[] | null) | null
  languages: (PieceDialogOption & { hint?: string })[]
  plannedLine?: string | null
  onSave: (draft: PieceDraft) => void
  onSaveAndAddAnother?: (draft: PieceDraft) => void
  onRemove?: () => void
  onCancel: () => void
  busy?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const [d, setD] = useState<PieceDraft>({
    name: initial?.name ?? '',
    idea: initial?.idea ?? '',
    notes: initial?.notes ?? '',
    phaseId: initial?.phaseId ?? null,
    deliverableTypeId: initial?.deliverableTypeId ?? null,
    format: initial?.format ?? null,
    channel: initial?.channel ?? null,
    priority: initial?.priority ?? null,
    quantity: initial?.quantity ?? 1,
    ownerUserId: initial?.ownerUserId ?? null,
    languages: initial?.languages ?? [],
  })

  const set = <K extends keyof PieceDraft>(k: K, v: PieceDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const toggleLanguage = (code: string) =>
    setD((p) => ({
      ...p,
      languages: p.languages.includes(code)
        ? p.languages.filter((c) => c !== code)
        : [...p.languages, code],
    }))

  // The frame marks the phase and the name REQUIRED; the owner is required because Edward says a
  // piece leaves campaign setup with somebody's name on it. The TYPE is deliberately not required
  // here — ADR-0051 d.7 keeps it nullable forever, and the wizard's own gate catches the one case
  // that matters (ADR-0097 d.4: the proposal named something outside the catalogue).
  // The field is only SHOWN where the campaign runs in phases (ADR-0096 d.1 keeps them
  // optional). It is not required even then, though the frame marks it so: ADR-0096 d.8 lets
  // a piece arrive unplaced and be put in a phase by its due date on the timing step, and the
  // proposal routinely returns rows the model could not place. Refusing to save one here
  // would make that fallback unreachable. The timing step is where every row must have one.
  const hasPhases = phases.length > 0
  const ready = d.name.trim().length > 0 && d.ownerUserId != null && d.quantity >= 1

  return (
    <Modal
      onClose={onCancel}
      testId={`${testId}-dialog`}
      labelledById={`${testId}-title`}
      size="wide"
    >
      <div className="piece-dialog">
        <span className="piece-eyebrow">
          {mode === 'add' ? t(showWorkstream ? 'piece.fromAdd' : 'piece.fromAddLoose') : t('piece.fromEdit')}
        </span>
        <h2 id={`${testId}-title`} className="piece-title">
          {mode === 'add'
            ? showWorkstream
              ? t('piece.addTitle', { workstream: workstreamName })
              : t('piece.addTitleLoose')
            : t('piece.editTitle', { name: initial?.name ?? '' })}
        </h2>
        <p className="piece-lede">{mode === 'add' ? t(showWorkstream ? 'piece.addLede' : 'piece.addLedeLoose') : t('piece.editLede')}</p>

        <div className="piece-row piece-row-2">
          <label className="field" hidden={!showWorkstream}>
            <span className="field-label">{t('piece.workstream')}</span>
            {/* Shown, not chosen: the click decided it, and the caption says what it decides. */}
            <input value={workstreamName} readOnly data-testid={`${testId}-workstream`} />
            <span className="field-hint">{t('piece.setsDepartment', { department: departmentName })}</span>
          </label>
          <label className="field" hidden={!hasPhases}>
            <span className="field-label">{t('piece.phase')}</span>
            <select
              value={d.phaseId ?? ''}
              onChange={(e) => set('phaseId', e.target.value || null)}
              data-testid={`${testId}-phase`}
            >
              <option value="">{t('piece.choosePhase')}</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">
            {t('piece.name')} <span className="req-chip">{t('piece.required')}</span>
          </span>
          <input
            value={d.name}
            onChange={(e) => set('name', e.target.value)}
            data-testid={`${testId}-name`}
          />
        </label>

        <label className="field">
          <span className="field-label">{t('piece.idea')}</span>
          <input
            value={d.idea}
            onChange={(e) => set('idea', e.target.value)}
            data-testid={`${testId}-idea`}
          />
          <span className="field-hint">{t('piece.ideaHint')}</span>
        </label>

        {/* The type first, because it is the one that decides things: the task list the department
            will see, and the lead time the timing step counts back from. */}
        <div className="piece-row piece-row-3">
          <label className="field">
            <span className="field-label">{t('piece.type')}</span>
            <select
              value={d.deliverableTypeId ?? ''}
              onChange={(e) => set('deliverableTypeId', e.target.value || null)}
              data-testid={`${testId}-type`}
            >
              <option value="">{t('piece.chooseType')}</option>
              {types.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="field-hint">{t('piece.typeHint')}</span>
            {taskPreview && (
              <TaskPreview tasks={d.deliverableTypeId ? taskPreview(d.deliverableTypeId) : null} testId={`${testId}-tasks`} />
            )}
          </label>
          <label className="field">
            <span className="field-label">{t('piece.quantity')}</span>
            <input
              type="number"
              min={1}
              className="num-input"
              value={d.quantity}
              onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))}
              data-testid={`${testId}-quantity`}
            />
            <span className="field-hint">{t('piece.quantityHint')}</span>
          </label>
          <label className="field">
            <span className="field-label">
              {t('piece.owner')} <span className="req-chip">{t('piece.required')}</span>
            </span>
            <select
              value={d.ownerUserId ?? ''}
              onChange={(e) => set('ownerUserId', e.target.value || null)}
              data-testid={`${testId}-owner`}
            >
              <option value="">{t('piece.chooseOwner')}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className="piece-row piece-row-3">
          <label className="field">
            <span className="field-label">{t('piece.format')}</span>
            <select
              value={d.format ?? ''}
              onChange={(e) => set('format', e.target.value || null)}
              data-testid={`${testId}-format`}
            >
              <option value="">—</option>
              {formats.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('piece.channel')}</span>
            <select
              value={d.channel ?? ''}
              onChange={(e) => set('channel', e.target.value || null)}
              data-testid={`${testId}-channel`}
            >
              <option value="">—</option>
              {channels.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="field-hint">{t('piece.channelHint')}</span>
          </label>
          <label className="field">
            <span className="field-label">{t('piece.priority')}</span>
            <select
              value={d.priority ?? ''}
              onChange={(e) => set('priority', (e.target.value || null) as PieceDraft['priority'])}
              data-testid={`${testId}-priority`}
            >
              <option value="">—</option>
              <option value="high">{t('intake.who.priorities.high')}</option>
              <option value="medium">{t('intake.who.priorities.medium')}</option>
              <option value="low">{t('intake.who.priorities.low')}</option>
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label">{t('piece.languages')}</span>
          <div className="piece-langs">
            {languages.map((l) => {
              const on = d.languages.includes(l.id)
              return (
                <button
                  type="button"
                  key={l.id}
                  className={`piece-lang${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleLanguage(l.id)}
                  data-testid={`${testId}-lang-${l.id}`}
                >
                  {l.label}
                  {l.hint ? ` — ${l.hint}` : ''}
                </button>
              )
            })}
          </div>
          {/* I56.7: several languages is several pieces. Said here, where the choice is made. */}
          {d.languages.length > 1 && (
            <span className="field-hint" data-testid={`${testId}-langs-note`}>
              {t('piece.severalLanguages', { count: d.languages.length })}
            </span>
          )}
        </div>

        {/* Free text on purpose. The moment it has a schema it stops being the place you can put
            the thing that did not fit anywhere else, which is the whole job. */}
        <label className="field">
          <span className="field-label">{t('piece.notes')}</span>
          <textarea
            rows={2}
            value={d.notes}
            onChange={(e) => set('notes', e.target.value)}
            data-testid={`${testId}-notes`}
          />
          <span className="field-hint">{t('piece.notesHint')}</span>
        </label>

        {plannedLine && (
          <p className="piece-planned" data-testid={`${testId}-planned`}>{plannedLine}</p>
        )}

        <div className="piece-actions">
          <Button
            variant="primary"
            busy={busy}
            disabled={!ready}
            onClick={() => onSave(d)}
            data-testid={`${testId}-save`}
          >
            {mode === 'add' ? t('piece.addIt') : t('piece.saveChanges')}
          </Button>
          {mode === 'add' && onSaveAndAddAnother && (
            <Button
              variant="secondary"
              busy={busy}
              disabled={!ready}
              onClick={() => onSaveAndAddAnother(d)}
              data-testid={`${testId}-add-another`}
            >
              {t('piece.addAnother')}
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
            {t('piece.cancel')}
          </Button>
          {mode === 'edit' && onRemove && (
            <button
              type="button"
              className="piece-remove"
              onClick={onRemove}
              data-testid={`${testId}-remove`}
            >
              {t('piece.removeThis')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
