import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isCyclicDependency,
  useAddDependency,
  useRemoveDependency,
  type RequirementCandidate,
  type TaskDependency,
} from '../api/requirements-api'
import { Button, IconButton } from '../../../components/Button'

/**
 * The **Required input** cell (ADR-0069 d.5, d.6) — one column answering one question: what is
 * this task waiting for?
 *
 * It shows both kinds together, because they are the same question to the person reading it: the
 * tasks this task waits on, and the deliverable's outstanding external inputs (which cascade to
 * every task under it, d.7). Two columns would be one too many.
 *
 * SOFT (d.3). Nothing here disables anything. An unmet requirement is stated plainly — and stated
 * where the work is, so nobody has to go looking — but Start stays available and somebody who
 * presses on is flagged as having started ahead, which is a positive marker rather than a
 * violation.
 *
 * THE PICKER OFFERS THE LIVE TASK LIST, never `workflow_steps`: a renamed task shows its current
 * name, a removed one is absent, a hand-added one is present. Cross-deliverable picks are grouped
 * and labelled, because a dependency on another department's work is the case worth making
 * obvious rather than the one to hide.
 */
export interface RequiredInputProps {
  subTaskId: string
  deliverableId: string
  dependencies: readonly TaskDependency[]
  candidates: readonly RequirementCandidate[]
  /** The deliverable's outstanding external inputs — the same for every task under it. */
  externalInputs: readonly string[]
  canManage: boolean
}

export function RequiredInput({
  subTaskId,
  deliverableId,
  dependencies,
  candidates,
  externalInputs,
  canManage,
}: RequiredInputProps) {
  const { t } = useTranslation()
  const add = useAddDependency(deliverableId)
  const remove = useRemoveDependency(deliverableId)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mine = dependencies.filter((d) => d.subTaskId === subTaskId)
  // A task cannot wait on itself, and offering an existing pick again just produces a duplicate
  // the unique constraint would refuse.
  const taken = new Set(mine.map((d) => d.prerequisiteId))
  const offerable = candidates.filter((c) => c.id !== subTaskId && !taken.has(c.id))
  const ownTasks = offerable.filter((c) => c.sameDeliverable)
  // Grouped by deliverable, in the order the campaign's tasks came back, so the picker reads the
  // way the campaign does rather than alphabetically by an accident of naming.
  const otherDeliverables = offerable
    .filter((c) => !c.sameDeliverable)
    .reduce<Map<string, typeof offerable>>((acc, c) => {
      const key = c.deliverableName || ''
      acc.set(key, [...(acc.get(key) ?? []), c])
      return acc
    }, new Map())

  function onPick(prerequisiteId: string) {
    if (!prerequisiteId) return
    setError(null)
    add.mutate(
      { subTaskId, prerequisiteId },
      {
        onSuccess: () => setAdding(false),
        // B waits on A, then somebody makes A wait on B. The trigger refuses it; this is what
        // that refusal reads as.
        onError: (err) =>
          setError(t(isCyclicDependency(err) ? 'requirements.cycle' : 'requirements.addFailed')),
      },
    )
  }

  return (
    <div className="required-input" data-testid={`required-input-${subTaskId}`}>
      {mine.length === 0 && externalInputs.length === 0 && (
        <span className="muted" data-testid={`required-input-none-${subTaskId}`}>
          {t('requirements.none')}
        </span>
      )}

      <ul className="requirement-list">
        {mine.map((d) => (
          <li key={d.id} data-testid={`requirement-${d.id}`}>
            <span className={d.met ? 'requirement-met' : 'requirement-waiting'}>
              {d.met ? '✓' : '⏳'}
            </span>{' '}
            <span>{d.prerequisiteTitle}</span>
            {/* Named only when it is somebody else's work — that is the fact worth surfacing. */}
            {d.prerequisiteDeliverable && (
              <span className="muted"> · {d.prerequisiteDeliverable}</span>
            )}
            {canManage && (
              <IconButton
                icon="close" label={t('requirements.remove')}
                disabled={remove.isPending}
                onClick={() => remove.mutate(d.id)}
                data-testid={`requirement-remove-${d.id}`} />
            )}
          </li>
        ))}

        {/* Shown on every task under the deliverable, because that is what an external input is
            (d.7) — one pending item, not the same sentence copied onto six rows. Not removable
            from here: it belongs to the deliverable and is cleared once, below the table. */}
        {externalInputs.map((description) => (
          <li key={description} data-testid={`requirement-external-${subTaskId}`}>
            <span className="requirement-waiting">⏳</span> <span>{description}</span>
            <span className="muted"> · {t('requirements.external')}</span>
          </li>
        ))}
      </ul>

      {canManage &&
        (adding ? (
          <>
            {/* Grouped, so "this deliverable's own steps" is a heading rather than something the
                reader has to infer from which options lack a prefix. Edward reported the picker
                appearing to offer only OTHER deliverables' tasks; whatever the cause, a list where
                the two kinds are told apart only by punctuation made that impossible to see. */}
            <select
              autoFocus
              defaultValue=""
              onChange={(e) => onPick(e.target.value)}
              data-testid={`requirement-picker-${subTaskId}`}
            >
              <option value="">{t('requirements.pick')}</option>
              {ownTasks.length > 0 && (
                <optgroup label={t('requirements.groupThis')} data-testid={`requirement-group-own-${subTaskId}`}>
                  {ownTasks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {[...otherDeliverables].map(([name, tasks]) => (
                <optgroup key={name} label={name}>
                  {tasks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              variant="link"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button variant="link" icon="plus"
            onClick={() => setAdding(true)}
            data-testid={`requirement-add-${subTaskId}`}
          >{t('requirements.add')}</Button>
        ))}

      {error && (
        <p className="form-error" data-testid={`requirement-error-${subTaskId}`}>
          {error}
        </p>
      )}
    </div>
  )
}
