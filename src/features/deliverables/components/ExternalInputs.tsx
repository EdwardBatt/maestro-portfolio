import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAddPendingInput,
  useMarkInputArrived,
  type PendingInput,
} from '../api/requirements-api'
import { Button } from '../../../components/Button'
import { dayFormatter } from '../../../lib/time/iraq'

/**
 * What the deliverable is waiting on from OUTSIDE (ADR-0069 d.7–d.9).
 *
 * `deliverable_pending_inputs` has existed since August with no way to register one, clear one, or
 * see one. This is that.
 *
 * REGISTERED ON THE DELIVERABLE, not the task, and cascading to every task under it — one
 * *"waiting on Acme's logo pack"* rather than the same sentence copied onto six rows, and one
 * place to tick it off. Each task's **Required input** cell shows it; this panel is where it is
 * created and cleared.
 *
 * `description` IS MANDATORY, and that is the point rather than an oversight: ADR-0030 refused a
 * vague "blocked" and required a SPECIFIC item. A blocker nobody can name is a blocker nobody can
 * chase.
 *
 * `awaitedFrom` is free text (d.8) — "the client's agency" is a real answer no dropdown would
 * hold, and it is the field most likely to name something the schema cannot model.
 */
export interface ExternalInputsProps {
  deliverableId: string
  inputs: readonly PendingInput[]
  canManage: boolean
}

export function ExternalInputs({ deliverableId, inputs, canManage }: ExternalInputsProps) {
  const { t, i18n } = useTranslation()
  const addInput = useAddPendingInput(deliverableId)
  const markArrived = useMarkInputArrived(deliverableId)
  const [adding, setAdding] = useState(false)
  const [description, setDescription] = useState('')
  const [awaitedFrom, setAwaitedFrom] = useState('')

  const fmt = dayFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  const day = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : fmt.format(d)
  }

  /** How long this has been outstanding — the number d.9 exists to make answerable. */
  const waitingDays = (iso: string) => {
    const from = new Date(iso).getTime()
    if (Number.isNaN(from)) return null
    return Math.max(0, Math.floor((Date.now() - from) / 86_400_000))
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return
    addInput.mutate(
      { description, awaitedFrom },
      {
        onSuccess: () => {
          setDescription('')
          setAwaitedFrom('')
          setAdding(false)
        },
      },
    )
  }

  const outstanding = inputs.filter((i) => i.satisfiedAt === null)
  const cleared = inputs.filter((i) => i.satisfiedAt !== null)

  return (
    <section className="external-inputs" data-testid="external-inputs">
      <h3 className="org-section-heading">{t('requirements.externalHeading')}</h3>
      <p className="muted">{t('requirements.externalIntro')}</p>

      {inputs.length === 0 && (
        <p className="muted" data-testid="external-inputs-none">{t('requirements.externalNone')}</p>
      )}

      {inputs.length > 0 && (
        <ul className="requirement-list" data-testid="external-inputs-list">
          {[...outstanding, ...cleared].map((input) => {
            const days = input.satisfiedAt === null ? waitingDays(input.requestedAt) : null
            return (
              <li key={input.id} data-testid={`external-input-${input.id}`}>
                <span className={input.satisfiedAt ? 'requirement-met' : 'requirement-waiting'}>
                  {input.satisfiedAt ? '✓' : '⏳'}
                </span>{' '}
                <span>{input.description}</span>
                {input.awaitedFrom && <span className="muted"> · {input.awaitedFrom}</span>}
                {/* Asked-for date always; how long only while it is still outstanding, because
                    that is the number somebody would act on. */}
                <span className="muted"> · {t('requirements.asked', { date: day(input.requestedAt) })}</span>
                {days !== null && days > 0 && (
                  <span className="cell-warn" data-testid={`external-input-days-${input.id}`}>
                    {' '}
                    · {t('requirements.waitingDays', { n: days })}
                  </span>
                )}
                {/* Cleared once (I59): a cleared input stays cleared — awaited again, it is a new one. */}
                {canManage && input.satisfiedAt === null && (
                  <Button
                    variant="secondary" size="sm" icon="check"
                    disabled={markArrived.isPending}
                    onClick={() => markArrived.mutate(input.id)}
                    data-testid={`external-input-arrived-${input.id}`}
                  >
                    {t('requirements.markArrived')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canManage &&
        (adding ? (
          <form className="org-add-form" onSubmit={onAdd} data-testid="external-input-form">
            <input
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('requirements.descriptionHint')}
              data-testid="external-input-description"
            />
            <input
              value={awaitedFrom}
              onChange={(e) => setAwaitedFrom(e.target.value)}
              placeholder={t('requirements.awaitedFromHint')}
              data-testid="external-input-awaited-from"
            />
            <Button
              variant="primary"
              type="submit"
              disabled={addInput.isPending || !description.trim()}
              data-testid="external-input-save"
            >
              {t('requirements.addInput')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : (
          <Button variant="link" icon="plus"
            onClick={() => setAdding(true)}
            data-testid="external-input-add"
          >{t('requirements.addInput')}</Button>
        ))}
    </section>
  )
}
