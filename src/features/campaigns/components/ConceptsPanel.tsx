import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BusyDialog } from '../../../components/Notice'
import { Tag } from '../../../components/Tag'
import {
  BriefEmptyError,
  NothingRemovedError,
  openSlots,
  useConcept,
  useDiscardConcept,
  useMarkConceptItem,
  useProposeConcepts,
  type ConceptShape,
  type Proposal,
} from '../api/concepts-api'
import { Button, IconButton, DeleteButton } from '../../../components/Button'
import { stampFormatter } from '../../../lib/time/iraq'

/**
 * The ONE working concept proposed against a department's brief (ADR-0065 + its 13 Sep addendum,
 * I34.4 / I48.15).
 *
 * Sits UNDER the brief and visibly apart from it, because that separation is the decision: a
 * concept is a proposal, and approving a brief does not approve concepts (d.6). Nothing here can
 * write into the brief above it.
 *
 * **On demand only** (d.7). Nothing is proposed automatically — the model costs money each press,
 * and an unread concept generated on page load is money spent on nobody's behalf.
 *
 * **Refined in place** (addendum d.10/d.11). Each item is KEPT (confirmed) or DELETED. A deletion
 * opens a slot in that shape; "Regenerate removed" asks the model for exactly the deleted items
 * with the kept ones as fixed context, and they take the deleted ones' place. There is no history
 * of sets to scroll: the concept on screen is the concept.
 */
export function ConceptsPanel({
  briefId,
  canPropose,
  testId,
}: {
  briefId: string
  /** `projects:manage` — the same grant that edits the brief above (d.7). */
  canPropose: boolean
  testId: string
}) {
  const { t, i18n } = useTranslation()
  const concept = useConcept(briefId)
  const propose = useProposeConcepts(briefId)
  const mark = useMarkConceptItem(briefId)
  const discard = useDiscardConcept(briefId)
  const [error, setError] = useState<string | null>(null)
  const [armedDiscard, setArmedDiscard] = useState(false)

  const stamp = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  const at = (iso: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : stamp.format(d)
  }

  const c = concept.data ?? null
  const slots = c ? openSlots(c.slots) : 0

  function onPropose() {
    setError(null)
    propose.mutate(undefined, {
      onError: (e) =>
        setError(
          e instanceof BriefEmptyError
            ? t('concepts.briefEmpty')
            : e instanceof NothingRemovedError
              ? t('concepts.nothingRemoved')
              : t('concepts.failed'),
        ),
    })
  }

  function onMark(itemId: string, action: 'keep' | 'delete') {
    if (!c) return
    setError(null)
    mark.mutate({ conceptId: c.id, itemId, action }, { onError: () => setError(t('concepts.markFailed')) })
  }

  function onDiscard() {
    if (!c) return
    if (!armedDiscard) {
      setArmedDiscard(true)
      return
    }
    setArmedDiscard(false)
    discard.mutate(c.id, { onError: () => setError(t('concepts.discardFailed')) })
  }

  return (
    <section className="concepts-panel" data-testid={testId}>
      <div className="concepts-head">
        <h3 className="concepts-heading">{t('concepts.heading')}</h3>
        {/* Said once, where it is read, and not only in an ADR: these are suggestions, and the
            brief above is the approved document. */}
        <span className="muted concepts-note">{t('concepts.note')}</span>
        {canPropose && (
          <Button
            variant="secondary"
            disabled={propose.isPending || (c != null && slots === 0)}
            title={c != null && slots === 0 ? t('concepts.regenerateHint') : undefined}
            onClick={onPropose}
            data-testid={`${testId}-propose`}
          >
            {c ? t('concepts.regenerate', { n: slots }) : t('concepts.propose')}
          </Button>
        )}
      </div>

      {/* ADR-0092 d.1: a model call spans seconds — a blocking "please wait" modal, not a spinner. */}
      {propose.isPending && (
        <BusyDialog text={c ? t('concepts.regenerating') : t('concepts.proposing')} testId={`${testId}-busy`} />
      )}

      {error && (
        <p className="form-error" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}

      {concept.isError ? (
        <p className="form-error" data-testid={`${testId}-load-failed`}>{t('concepts.loadFailed')}</p>
      ) : !c ? (
        <p className="muted" data-testid={`${testId}-empty`}>{t('concepts.none')}</p>
      ) : (
        <article className="concept-set" data-testid={`${testId}-concept`}>
          <header className="concept-set-head muted">
            <span>
              {t('concepts.proposedBy', { who: c.requestedByName ?? '—', when: at(c.createdAt) ?? '' })}
              {/* The per-press audit the addendum keeps: how many times, last by whom. */}
              {c.regenerations > 0 && (
                <>
                  {' · '}
                  <span data-testid={`${testId}-regenerations`}>
                    {t('concepts.regeneratedBy', {
                      count: c.regenerations,
                      who: c.regeneratedByName ?? '—',
                      when: at(c.regeneratedAt) ?? '',
                    })}
                  </span>
                </>
              )}
              {slots > 0 && (
                <>
                  {' · '}
                  <span data-testid={`${testId}-slots`}>{t('concepts.slotsOpen', { count: slots })}</span>
                </>
              )}
            </span>
            {canPropose && (
              <DeleteButton
                armed={armedDiscard}
                label={t('concepts.discard')}
                confirm={t('concepts.discardConfirm')}
                disabled={discard.isPending}
                onClick={onDiscard}
                data-testid={`${testId}-discard`}
              />
            )}
          </header>
          {c.proposals.length === 0 ? (
            <p className="muted" data-testid={`${testId}-all-removed`}>{t('concepts.allRemoved')}</p>
          ) : (
            <ProposalList
              proposals={c.proposals}
              canMark={canPropose}
              marking={mark.isPending}
              onMark={onMark}
              testId={`${testId}-concept`}
            />
          )}
        </article>
      )}
    </section>
  )
}

const SHAPE_ORDER: ConceptShape[] = ['strategic_thinking', 'creative_direction', 'pillars']

/** Grouped by shape, in reading order: thinking, then direction, then pillars. */
function ProposalList({
  proposals,
  canMark,
  marking,
  onMark,
  testId,
}: {
  proposals: Proposal[]
  canMark: boolean
  marking: boolean
  onMark: (itemId: string, action: 'keep' | 'delete') => void
  testId: string
}) {
  const { t } = useTranslation()
  return (
    <>
      {SHAPE_ORDER.map((shape) => {
        const rows = proposals.filter((p) => p.shape === shape)
        if (rows.length === 0) return null
        return (
          <div className="concept-group" key={shape} data-testid={`${testId}-${shape}`}>
            <h4 className="concept-group-head">{t(`concepts.shape.${shape}`)}</h4>
            <ul className="concept-list">
              {rows.map((p) => (
                <li className={`concept-item${p.kept ? ' is-kept' : ''}`} key={p.id} data-testid={`${testId}-item-${p.id}`}>
                  <div className="concept-item-head">
                    {p.name && <span className="concept-item-name">{p.name}</span>}
                    {p.kept && (
                      <span data-testid={`${testId}-kept-${p.id}`}>
                        <Tag tone="ok">{t('concepts.kept')}</Tag>
                      </span>
                    )}
                    {/* Addendum d.10: keep or delete, per item. Delete opens a slot (d.11). */}
                    {canMark && (
                      <span className="concept-item-actions">
                        {!p.kept && (
                          <Button
                            variant="secondary" size="sm" icon="check"
                            disabled={marking}
                            onClick={() => onMark(p.id, 'keep')}
                            data-testid={`${testId}-keep-${p.id}`}
                          >
                            {t('concepts.keep')}
                          </Button>
                        )}
                        <IconButton
                          icon="trash"
                          danger
                          size="sm"
                          label={t('concepts.delete')}
                          disabled={marking}
                          onClick={() => onMark(p.id, 'delete')}
                          data-testid={`${testId}-delete-${p.id}`}
                        />
                      </span>
                    )}
                  </div>
                  <p className="concept-item-text">{p.text}</p>
                  {/* ADR-0065 d.4/d.5. The citation is what turns "do I like this?" into "does
                      this answer the brief?", and its ABSENCE is the more interesting signal —
                      either the brief is thin or the idea has wandered off it. Both want eyes,
                      so an unsupported proposal is marked and never hidden. */}
                  {p.answers.length > 0 ? (
                    <span className="concept-answers muted">
                      {t('concepts.answers', { fields: p.answers.join(', ') })}
                    </span>
                  ) : (
                    <span className="concept-unsupported" data-testid={`${testId}-unsupported`}>
                      {t('concepts.unsupported')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
