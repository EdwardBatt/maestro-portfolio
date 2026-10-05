import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { formatMoment, iraqDay } from '../../../lib/time/iraq'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { classifyWriteFailure } from '../../../lib/errors/classify'
import { fetchCampaignReferencesFolder, useFileDocuments } from '../api/document-filing-api'
import { useRequestDeliverableChange, type ChangeRequestContext } from '../api/change-requests-api'
import {
  costFigures,
  escalatesAt,
  landsOn,
  pgInstant,
  requestLine,
  sendError,
  toRpcChanges,
  workCost,
  type AskedBy,
  type ChangeField,
  type ChangeRequestRow,
  type FieldChange,
  type RequestedChanges,
} from '../lib/change-request'

/**
 * **This work has started** — Figma `CG-E2` (1710:877), ADR-0110 + addendum, I59.23.
 *
 * Opened by Edit's Save when the type, quantity or due date of a STARTED deliverable changed. It
 * saves none of them: it says what changes (before → after), what it costs (the work already put in
 * — the started tasks and their booked and timed hours — and where the piece now lands), asks who
 * asked for it (required: the client — a revision round; us — costs us, counts nothing), and for a
 * due date asks for the client's evidence without requiring it (E5). Then **Send it to <owner> as a
 * change request** (`request_deliverable_change`) or **Keep it as it was** (nothing is sent).
 *
 * The evidence is filed exactly as the evidenced due-date dialog files it (ADR-0088 d.7a,
 * `DeliverableDueAtDialog`): into the campaign's References, then named to the RPC.
 *
 * One open request per deliverable: when one is already open this says so and shows it, and
 * offers no Send.
 */
export interface ChangeRequestDialogProps {
  deliverableId: string
  deliverableName: string
  campaignId: string
  clientId: string
  currentDueAt: string | null
  changes: RequestedChanges
  /** Who answers — the owner as saved (a new owner saved a moment ago answers). */
  ownerName: string
  context: ChangeRequestContext
  /** A type id → its name, for the before / after. */
  typeName: (id: string | null) => string
  onSent: () => void
  onKeep: () => void
}

const FIELDS: readonly ChangeField[] = ['type', 'quantity', 'due']

export function ChangeRequestDialog({
  deliverableId,
  deliverableName,
  campaignId,
  clientId,
  currentDueAt,
  changes,
  ownerName,
  context,
  typeName,
  onSent,
  onKeep,
}: ChangeRequestDialogProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const send = useRequestDeliverableChange()
  const file = useFileDocuments()
  const [askedBy, setAskedBy] = useState<AskedBy | null>(null)
  const [evidence, setEvidence] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The clock starts when the request is sent; read once, so the line does not tick while open.
  const [openedAt] = useState(() => Date.now())

  const nowDueDay = currentDueAt ? iraqDay(currentDueAt) : null
  const cost = workCost(context.tasks)
  const landing = landsOn(changes, nowDueDay)
  const deadline = escalatesAt(openedAt, context.escalationHours)
  const day = (d: string | null) => (d ? formatPlanDay(d, loc) : t('changeRequest.none'))

  const shown = (field: ChangeField, c: FieldChange, side: 'from' | 'to') => {
    const v = c[side]
    if (field === 'type') return v ? typeName(v) : t('changeRequest.none')
    if (field === 'due') return day(v)
    return v ?? t('changeRequest.none')
  }

  async function submit() {
    const why = sendError(askedBy)
    if (why) return setError(t(`changeRequest.${why}`))
    setError(null)
    setBusy(true)
    try {
      let evidenceAssetId: string | null = null
      if (changes.due && evidence) {
        // ADR-0088 d.7a's path: filed into the campaign's References first, then named.
        const folderId = await fetchCampaignReferencesFolder(campaignId)
        if (!folderId) return setError(t('changeRequest.evidenceNoFolder'))
        const [outcome] = await file.mutateAsync({ folderId, clientId, files: [evidence] })
        if (!outcome?.ok || !outcome.assetId) return setError(t('changeRequest.evidenceFailed'))
        evidenceAssetId = outcome.assetId
      }
      await send.mutateAsync({
        deliverableId,
        changes: toRpcChanges(changes),
        askedBy: askedBy!,
        cost: costFigures(cost, landing),
        evidenceAssetId,
      })
      onSent()
    } catch (err) {
      setError(classifyWriteFailure(err, t('changeRequest.failed'), t('changeRequest.outsideReach'), t).text)
    } finally {
      setBusy(false)
    }
  }

  // One open question per deliverable: say so, and show it.
  if (context.openRequest) {
    return (
      <Modal onClose={onKeep} labelledById="change-request-title" testId="change-request-dialog">
        <ModalHeader
          id="change-request-title"
          eyebrow={t('changeRequest.eyebrow')}
          title={t('changeRequest.alreadyOpenTitle')}
          subtitle={t('changeRequest.alreadyOpenIntro', { name: deliverableName })}
        />
        <div className="modal-body change-request" data-testid="change-request-already-open">
          <OpenRequest request={context.openRequest} ownerName={ownerName} shownChange={shown} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onKeep} data-testid="change-request-keep">
            {t('changeRequest.keep')}
          </Button>
        </ModalFooter>
      </Modal>
    )
  }

  return (
    <Modal onClose={onKeep} labelledById="change-request-title" testId="change-request-dialog">
      <ModalHeader
        id="change-request-title"
        eyebrow={t('changeRequest.eyebrow')}
        title={t('changeRequest.title')}
        subtitle={t('changeRequest.intro', { name: deliverableName, owner: ownerName })}
      />
      <div className="modal-body change-request">
        <section aria-labelledby="change-request-what">
          <h3 id="change-request-what" className="change-request-head">{t('changeRequest.whatChanges')}</h3>
          <ul className="change-request-changes" data-testid="change-request-changes">
            {FIELDS.filter((f) => changes[f]).map((f) => (
              <li key={f} data-testid={`change-request-change-${f}`}>
                <span className="change-request-field">{t(`changeRequest.field.${f}`)}</span>
                <span className="change-request-from">{shown(f, changes[f]!, 'from')}</span>
                <span className="change-request-arrow" aria-hidden="true">→</span>
                <span className="change-request-to">{shown(f, changes[f]!, 'to')}</span>
              </li>
            ))}
          </ul>
          {changes.type && (
            <p className="change-request-note" data-testid="change-request-type-note">
              {t('changeRequest.typeNote', { owner: ownerName })}
            </p>
          )}
        </section>

        <section aria-labelledby="change-request-cost">
          <h3 id="change-request-cost" className="change-request-head">{t('changeRequest.whatItCosts')}</h3>
          {cost.started.length === 0 ? (
            <p className="muted" data-testid="change-request-cost-none">{t('changeRequest.costNone')}</p>
          ) : (
            <>
              <p data-testid="change-request-cost-total">
                {t('changeRequest.costTotal', { count: cost.started.length, booked: cost.bookedHours, timed: cost.timedHours })}
              </p>
              <ul className="change-request-tasks" data-testid="change-request-cost-tasks">
                {cost.started.map((task) => (
                  <li key={task.id} data-testid={`change-request-cost-task-${task.id}`}>
                    <span className="change-request-task-title">{task.title}</span>
                    <span className="muted">
                      {t(`deliverables.subStatus.${task.status}`)} · {t('changeRequest.taskHours', { booked: task.bookedHours, timed: task.timedHours })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p data-testid="change-request-lands">{t('changeRequest.landsOn', { date: day(landing) })}</p>
        </section>

        <fieldset className="change-request-who" data-testid="change-request-asked-by">
          <legend className="change-request-head">
            {t('changeRequest.whoAsked')} <span className="change-request-required">{t('changeRequest.required')}</span>
          </legend>
          {(['client', 'us'] as const).map((who) => (
            <label key={who} className={`change-request-choice${askedBy === who ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="change-request-asked-by"
                value={who}
                checked={askedBy === who}
                onChange={() => {
                  setAskedBy(who)
                  setError(null)
                }}
                data-testid={`change-request-asked-by-${who}`}
              />
              <span>
                <strong>{t(`changeRequest.askedBy.${who}`)}</strong>
                <span className="muted">{t(`changeRequest.askedBy.${who}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* E5: asked for, never required — logged either way. */}
        {changes.due && (
          <label className="change-request-evidence">
            <span className="change-request-head">{t('changeRequest.evidence')}</span>
            <input
              type="file"
              accept="image/*,.pdf,.eml,.msg,.txt"
              onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
              data-testid="change-request-evidence"
            />
            <span className="muted">{t('changeRequest.evidenceHint')}</span>
          </label>
        )}

        {error && <p className="form-error" role="alert" data-testid="change-request-error">{error}</p>}
      </div>
      {/* CG-E2: when it escalates is the foot's quiet note. */}
      <ModalFooter
        note={
          deadline != null ? (
            <span className="change-request-clock" data-testid="change-request-escalates">
              {t('changeRequest.escalates', { owner: ownerName, time: formatMoment(deadline, loc) })}
            </span>
          ) : undefined
        }
      >
        <Button variant="primary" tone="change" busy={busy} disabled={busy} onClick={() => void submit()} data-testid="change-request-send">
          {t('changeRequest.send', { owner: ownerName })}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onKeep} data-testid="change-request-keep">
          {t('changeRequest.keep')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** The request already open on the piece — its line, and what it asks. */
function OpenRequest({
  request,
  ownerName,
  shownChange,
}: {
  request: ChangeRequestRow
  ownerName: string
  shownChange: (f: ChangeField, c: FieldChange, side: 'from' | 'to') => string
}) {
  const { t } = useTranslation()
  const line = requestLine(request, ownerName)
  // `from` on the record is the server's reading: a due is a timestamptz's text there
  // ("2099-09-24 15:00:00+00"), a day here.
  const asDay = (f: ChangeField, c: FieldChange): FieldChange =>
    f === 'due' ? { from: c.from ? iraqDay(pgInstant(c.from)) : null, to: c.to } : c
  return (
    <>
      <p className="change-request-state" data-testid="change-request-open-line">{t(line.key, line.values)}</p>
      <ul className="change-request-changes" data-testid="change-request-open-changes">
        {FIELDS.filter((f) => request.changes[f]).map((f) => (
          <li key={f}>
            <span className="change-request-field">{t(`changeRequest.field.${f}`)}</span>
            <span className="change-request-from">{shownChange(f, asDay(f, request.changes[f]!), 'from')}</span>
            <span className="change-request-arrow" aria-hidden="true">→</span>
            <span className="change-request-to">{shownChange(f, asDay(f, request.changes[f]!), 'to')}</span>
          </li>
        ))}
      </ul>
      <p className="muted">{t('changeRequest.alreadyOpenNote')}</p>
    </>
  )
}

