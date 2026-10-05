import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isValidCodeLetters, normaliseCodeLetters, suggestCodeLetters } from '../../../lib/campaigns/code-letters'
import { Button, IconButton } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PersonPicker } from '../../../components/PersonPicker'
import {
  useMoveDeliverableToWorkstream,
  useRemoveWorkstream,
  useSaveWorkstream,
  type Workstream,
} from '../api/workstreams-api'
import { leadsOfDepartment } from '../../../lib/people/leads-of-department'

/**
 * A campaign's work, in named groups (ADR-0099, `I56.3` — the v3 Figma's CB-v3-03).
 *
 * **Grouping is optional and that shapes everything here.** A campaign may have no workstreams at
 * all, and a deliverable may belong to none; ungrouped is a normal, permanent state, not a step on
 * the way to being grouped. So this panel never nags, never shows an empty-with-a-call-to-action
 * state for a campaign that simply does not work this way, and the ungrouped list is titled as
 * work rather than as a problem.
 *
 * What a person does here: make a group, rename or re-own one, move a deliverable between groups
 * (or out of all of them), and remove an empty one. Each is one RPC, because each carries a rule
 * the screen must not be trusted to keep:
 *
 *  - a group's department is stamped onto the work that joins it (d.3), so moving is how work
 *    changes department — deliberately, by a person, rather than as a side effect of a rename;
 *  - taking work OUT changes the grouping and nothing else (d.4);
 *  - removing a group that still holds work is refused with the count (d.8) — and this panel shows
 *    that count beforehand, so the refusal is a last resort rather than the way you find out.
 */
export interface GroupedDeliverable {
  id: string
  name: string
  workstreamId: string | null
  ownerName: string | null
}

export function WorkstreamsPanel({
  campaignId,
  workstreams,
  deliverables,
  departments,
  people,
  canManage,
  testId,
  onError,
}: {
  campaignId: string
  workstreams: Workstream[]
  deliverables: GroupedDeliverable[]
  departments: { id: string; name: string }[]
  /** Who may be named as a group's owner. Passed in rather than read here: the campaign page
   *  already holds the tenant's people and the ranking they are shown in. */
  people: readonly { id: string; name: string; hint?: string | null; departmentId?: string | null }[]
  /** ADR-0099: making and moving groups is the campaign's authority, the same as adding work. */
  canManage: boolean
  testId: string
  onError?: (message: string) => void
}) {
  const { t } = useTranslation()
  const save = useSaveWorkstream()
  const move = useMoveDeliverableToWorkstream()
  const remove = useRemoveWorkstream()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; departmentId: string; ownerUserId: string | null }>({
    name: '',
    departmentId: '',
    ownerUserId: null,
  })
  const [confirmRemove, setConfirmRemove] = useState<Workstream | null>(null)
  // I59.54: null while the letters follow the name; the person's own once they type. Only when making one.
  const [typedLetters, setTypedLetters] = useState<string | null>(null)
  const letters = typedLetters ?? (draft.name.trim() ? suggestCodeLetters(draft.name) : '')
  const lettersBad = adding && typedLetters !== null && !isValidCodeLetters(typedLetters)

  const fail = (e: unknown) => onError?.(e instanceof Error ? e.message : String(e))
  const ungrouped = deliverables.filter((d) => d.workstreamId == null)

  const beginAdd = () => {
    setDraft({ name: '', departmentId: departments[0]?.id ?? '', ownerUserId: null })
    setTypedLetters(null)
    setEditing(null)
    setAdding(true)
  }
  const beginEdit = (w: Workstream) => {
    setDraft({ name: w.name, departmentId: w.departmentId, ownerUserId: w.ownerUserId })
    setAdding(false)
    setEditing(w.id)
  }
  const close = () => {
    setAdding(false)
    setEditing(null)
  }

  const submit = () =>
    save.mutate(
      {
        campaignId,
        name: draft.name,
        departmentId: draft.departmentId,
        ownerUserId: draft.ownerUserId,
        workstreamId: editing,
        codeLetters: !editing && typedLetters !== null ? normaliseCodeLetters(typedLetters) : null,
      },
      { onSuccess: close, onError: fail },
    )

  const form = (
    <div className="workstream-form" data-testid={`${testId}-form`}>
      <label className="field">
        <span className="field-label">{t('workstreams.name')}</span>
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder={t('workstreams.namePlaceholder')}
          data-testid={`${testId}-name`}
        />
      </label>
      {adding && (
        <label className="field new-workstream-letters">
          <span className="field-label">{t('newWorkstream.letters')}</span>
          <input
            value={letters}
            maxLength={4}
            dir="ltr"
            onChange={(e) => setTypedLetters(e.target.value.toUpperCase())}
            aria-invalid={lettersBad}
            data-testid={`${testId}-letters`}
          />
          {(letters || lettersBad) && (
            <span className={lettersBad ? 'field-error' : 'field-hint'} data-testid={`${testId}-letters-hint`}>
              {lettersBad
                ? t('newWorkstream.lettersInvalid')
                : t('newWorkstream.lettersHint', { example: `${normaliseCodeLetters(letters)}-001` })}
            </span>
          )}
        </label>
      )}
      <label className="field">
        <span className="field-label">{t('workstreams.department')}</span>
        <select
          value={draft.departmentId}
          onChange={(e) => setDraft((d) => ({ ...d, departmentId: e.target.value }))}
          data-testid={`${testId}-department`}
        >
          <option value="">{t('workstreams.chooseDepartment')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">{t('workstreams.owner')}</span>
        {/* ADR-0099 d.5: chosen, not inferred, and may be left empty — a group can exist before
            anybody has been put in charge of it. */}
        {/* I66.9: the chosen department's leads only (every lead until a department is chosen). */}
        <PersonPicker
          people={leadsOfDepartment(people.map((p) => ({ ...p, departmentId: p.departmentId ?? null })), draft.departmentId || null)}
          value={draft.ownerUserId ?? ''}
          onChange={(id) => setDraft((d) => ({ ...d, ownerUserId: id || null }))}
          testId={`${testId}-owner`}
        />
      </label>
      <div className="form-actions">
        <Button
          variant="primary"
          size="sm"
          busy={save.isPending}
          disabled={!draft.name.trim() || !draft.departmentId || lettersBad}
          onClick={submit}
          data-testid={`${testId}-save`}
        >
          {editing ? t('workstreams.saveChanges') : t('workstreams.create')}
        </Button>
        <Button variant="secondary" size="sm" onClick={close} data-testid={`${testId}-cancel`}>
          {t('workstreams.cancel')}
        </Button>
      </div>
      {/* Changing a group's department moves its work. Said before they press, not after. */}
      {editing && draft.departmentId !== workstreams.find((w) => w.id === editing)?.departmentId && (
        <p className="cell-warn" data-testid={`${testId}-moves-work`}>
          {t('workstreams.changingDepartmentMovesWork', {
            count: workstreams.find((w) => w.id === editing)?.deliverableCount ?? 0,
          })}
        </p>
      )}
    </div>
  )

  return (
    <section className="workstreams-panel" data-testid={testId}>
      <header className="schedule-bar">
        <h3>{t('workstreams.heading')}</h3>
        {canManage && !adding && !editing && (
          <Button variant="secondary" size="sm" icon="plus" onClick={beginAdd} data-testid={`${testId}-add`}>
            {t('workstreams.add')}
          </Button>
        )}
      </header>

      {adding && form}

      {workstreams.length === 0 && !adding && (
        /* Not a call to action: a campaign with no groups is a campaign that does not need them
           (ADR-0099 d.1). One line, no button shouting at them. */
        <p className="muted" data-testid={`${testId}-none`}>{t('workstreams.noneYet')}</p>
      )}

      {workstreams.map((w) => {
        const mine = deliverables.filter((d) => d.workstreamId === w.id)
        return (
          <div className="workstream" key={w.id} data-testid={`${testId}-group-${w.id}`}>
            {editing === w.id ? (
              form
            ) : (
              <header className="workstream-head">
                <span className="my-work-title" data-testid={`${testId}-group-name-${w.id}`}>{w.name}</span>
                <span className="my-work-meta muted">
                  {w.departmentName ?? '—'}
                  {' · '}
                  {t('workstreams.ownerIs', { name: w.ownerName ?? t('workstreams.noOwner') })}
                  {' · '}
                  {t('workstreams.holds', { count: mine.length })}
                </span>
                {canManage && (
                  <span className="row-actions">
                    <IconButton
                      icon="edit"
                      size="sm"
                      label={t('workstreams.edit')}
                      onClick={() => beginEdit(w)}
                      data-testid={`${testId}-edit-${w.id}`}
                    />
                    <IconButton
                      icon="trash"
                      danger
                      size="sm"
                      label={t('workstreams.remove')}
                      onClick={() =>
                        // d.8: refused in words, in the same terms the server would use, rather
                        // than by opening a dialog whose confirm cannot be pressed. The count is
                        // already on the header, so this only ever confirms what they can see.
                        w.deliverableCount > 0
                          ? onError?.(t('workstreams.cannotRemove', { name: w.name, count: w.deliverableCount }))
                          : setConfirmRemove(w)
                      }
                      data-testid={`${testId}-remove-${w.id}`}
                    />
                  </span>
                )}
              </header>
            )}

            <ul className="workstream-rows">
              {mine.map((d) => (
                <li key={d.id} data-testid={`${testId}-item-${d.id}`}>
                  <span className="my-work-title">{d.name}</span>
                  <span className="my-work-meta muted">{d.ownerName ?? '—'}</span>
                  {canManage && (
                    <select
                      value={w.id}
                      aria-label={t('workstreams.moveTo')}
                      onChange={(e) =>
                        move.mutate(
                          { deliverableId: d.id, workstreamId: e.target.value || null },
                          { onError: fail },
                        )
                      }
                      data-testid={`${testId}-move-${d.id}`}
                    >
                      {workstreams.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                      {/* ADR-0116 d.3: a campaign piece moves between workstreams only — no "out of any". */}
                    </select>
                  )}
                </li>
              ))}
              {mine.length === 0 && (
                <li className="muted" data-testid={`${testId}-empty-${w.id}`}>{t('workstreams.emptyGroup')}</li>
              )}
            </ul>
          </div>
        )
      })}

      {/* Ungrouped work is work, not a to-do list. It is titled plainly and only appears when
          there is some — a campaign that groups nothing shows one line above and no heading here. */}
      {ungrouped.length > 0 && workstreams.length > 0 && (
        <div className="workstream workstream-ungrouped" data-testid={`${testId}-ungrouped`}>
          <header className="workstream-head">
            <span className="my-work-title">{t('workstreams.ungrouped')}</span>
            <span className="my-work-meta muted">{t('workstreams.holds', { count: ungrouped.length })}</span>
          </header>
          <ul className="workstream-rows">
            {ungrouped.map((d) => (
              <li key={d.id} data-testid={`${testId}-item-${d.id}`}>
                <span className="my-work-title">{d.name}</span>
                <span className="my-work-meta muted">{d.ownerName ?? '—'}</span>
                {canManage && (
                  <select
                    value=""
                    aria-label={t('workstreams.moveTo')}
                    onChange={(e) =>
                      e.target.value &&
                      move.mutate({ deliverableId: d.id, workstreamId: e.target.value }, { onError: fail })
                    }
                    data-testid={`${testId}-move-${d.id}`}
                  >
                    <option value="">{t('workstreams.ungrouped')}</option>
                    {workstreams.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('workstreams.removeTitle', { name: confirmRemove.name })}
          // d.8: the count is shown BEFORE they press, so the server's refusal is a backstop
          // rather than how somebody finds out their group is not empty.
          message={t('workstreams.removeEmpty')}
          confirmLabel={t('workstreams.remove')}
          tone="danger"
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(confirmRemove.id, {
              onSuccess: () => setConfirmRemove(null),
              onError: (e) => {
                fail(e)
                setConfirmRemove(null)
              },
            })
          }
          onCancel={() => setConfirmRemove(null)}
          testId={`${testId}-confirm-remove`}
        />
      )}
    </section>
  )
}
