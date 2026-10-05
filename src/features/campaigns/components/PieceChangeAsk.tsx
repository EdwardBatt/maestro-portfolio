import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { formatCalendarDay, formatIraqDateTime, iraqDay } from '../../../lib/time/iraq'
import { classifyWriteFailure } from '../../../lib/errors/classify'
import { usePieceAskContext, usePieceChangeAsks, useWithdrawDeliverableChange } from '../api/change-asks-api'
import { agoParts, askToShow, kindsToMakeInThePiece, toldNames, type ChangeAskRow } from '../lib/change-ask'
import { ChangeAskAnswerDialog } from './ChangeAskAnswerDialog'
import { ChangeAskDialog } from './ChangeAskDialog'
import { useLanguageWords } from '../../admin/api/deliverable-types-api'

/**
 * **The piece header** (mock-up 6, Figma CP-07–CP-09; ADR-0141 d.1–d.4; I74.13 UI, I74.15).
 *
 * For whoever may not change the piece (`locked`: its owner, the department's leads) the deliverable's fields read
 * here — format, language, hours, due to the client — with **Ask <account manager> to change it** (the one form,
 * CP-06). While an ask waits the strip says what was asked beside what is ("About 12 → asked 16") and a banner says
 * "Waiting on Inas · sent 20 min ago" with **See your ask** and **Withdraw the ask** for the asker (CP-07). Once she
 * answers, the asker reads it here until OK: accepted — the new values, her note and who was told (CP-08); kept — her
 * reason, with Reply (a new ask) and OK (CP-09).
 *
 * For the account manager's side (`locked` false: the account manager, the account director, Traffic, the Power
 * Admin — approve_campaign's gate, mirrored) the fields stay editable in the panel below, and a waiting ask shows
 * here with **Answer** (ADR-0141 d.4). The database decides both; this only offers.
 */
const seenKey = (askId: string) => `maestro.changeAsk.seen.${askId}`
function wasSeen(askId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(askId)) === '1'
  } catch {
    return false
  }
}
function markSeen(askId: string): void {
  try {
    window.localStorage.setItem(seenKey(askId), '1')
  } catch {
    /* per-viewer convenience only */
  }
}

export function PieceChangeAsk({
  deliverableId,
  locked,
  viewerId,
  testId = 'piece-ask',
}: {
  deliverableId: string
  /** The signed-in person — the asker sees her own ask's Withdraw and its answer. */
  viewerId: string | null
  /** True for whoever may not change the deliverable directly — they read it here and ask. */
  locked: boolean
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const languageList = useLanguageWords()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const myId = viewerId
  const ctx = usePieceAskContext(deliverableId, loc)
  const asks = usePieceChangeAsks(deliverableId)
  const withdraw = useWithdrawDeliverableChange()
  const [asking, setAsking] = useState(false)
  const [answering, setAnswering] = useState<ChangeAskRow | null>(null)
  const [seeing, setSeeing] = useState(false)
  const [, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const piece = ctx.data ?? null
  const shown = askToShow(asks.data ?? [])
  const pending = shown?.status === 'pending' ? shown : null
  const answered = shown && shown.status !== 'pending' && shown.askedBy === myId && !wasSeen(shown.id) ? shown : null
  const mine = pending?.askedBy === myId
  const am = piece?.accountManagerName ?? t('changeAsk.theAm')
  const dueDay = piece?.dueAt ? iraqDay(piece.dueAt) : null
  const day = (d: string) => formatCalendarDay(d, loc)

  if (!locked && !pending) return null

  const tone = pending ? 'is-waiting' : answered && answered.status !== 'kept' ? 'is-accepted' : ''
  const hoursNow = piece?.hours != null ? t('changeAsk.strip.about', { hours: piece.hours }) : '—'
  const hoursCell = pending?.requestedHours != null
    ? <span className="is-asked">{t('changeAsk.strip.asked', { now: hoursNow, asked: pending.requestedHours })}</span>
    : answered && answered.status !== 'kept' && answered.appliedHours != null
      ? <span className="is-applied">{t('changeAsk.strip.was', { now: answered.appliedHours, was: piece?.hours ?? '—' })}</span>
      : hoursNow
  const dueCell = pending?.requestedDueDay
    ? <span className="is-asked">{t('changeAsk.strip.asked', { now: dueDay ? day(dueDay) : '—', asked: day(pending.requestedDueDay) })}</span>
    // The deliverable's own due date, always (an old accepted ask's day once stood here after a later change).
    : answered && answered.status !== 'kept' && answered.appliedDueDay && dueDay
      ? <span className="is-applied">{day(dueDay)}</span>
      : dueDay ? day(dueDay) : '—'

  function doWithdraw(a: ChangeAskRow) {
    setError(null)
    withdraw.mutate(a.id, {
      onError: (err) => setError(classifyWriteFailure(err, t('changeAsk.failed'), t('changeAsk.outsideReach'), t).text),
    })
  }

  const ago = pending ? agoParts(pending.createdAt, Date.now()) : null
  const agoText = ago ? t(`changeAsk.ago.${ago.unit}`, { count: ago.count }) : ''
  const askedWhat = (a: ChangeAskRow) => {
    const parts = [
      a.requestedHours != null ? t('changeAsk.banner.hours', { count: a.requestedHours }) : null,
      a.requestedDueDay ? day(a.requestedDueDay) : null,
      ...kindsToMakeInThePiece(a.kinds).map((k) => t(`changeAsk.kind.${k}`).toLocaleLowerCase(loc)),
    ].filter((x): x is string => !!x)
    return parts.join(t('changeAsk.banner.and'))
  }

  return (
    <div className="piece-ask" data-testid={testId}>
      {locked && (
        <div className={`piece-ask-strip ${tone}`} data-testid={`${testId}-strip`}>
          <div className="piece-ask-cell">
            <span className="piece-ask-k">{t('changeAsk.strip.format')}</span>
            <span className="piece-ask-v" dir="auto">{[piece?.typeName, piece?.channel].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div className="piece-ask-cell">
            <span className="piece-ask-k">{t('changeAsk.strip.language')}</span>
            <span className="piece-ask-v" dir="auto" data-testid={`${testId}-languages`}>{languageList.words(piece?.languages) || '—'}</span>
          </div>
          <div className="piece-ask-cell">
            <span className="piece-ask-k">{t('changeAsk.strip.quantity')}</span>
            <span className="piece-ask-v">{piece?.quantity ?? 1}</span>
          </div>
          <div className="piece-ask-cell">
            <span className="piece-ask-k">{t('changeAsk.strip.hours')}</span>
            <span className="piece-ask-v" data-testid={`${testId}-hours`}>{hoursCell}</span>
          </div>
          <div className="piece-ask-cell">
            <span className="piece-ask-k">{t('changeAsk.strip.due')}</span>
            <span className="piece-ask-v" data-testid={`${testId}-due`}>{dueCell}</span>
          </div>
          <span className="piece-ask-gap" />
          {pending && mine ? (
            <Button variant="secondary" size="sm" busy={withdraw.isPending} onClick={() => doWithdraw(pending)} data-testid={`${testId}-withdraw`}>
              {t('changeAsk.withdraw')}
            </Button>
          ) : !pending ? (
            <button type="button" className="piece-ask-button" onClick={() => setAsking(true)} data-testid={`${testId}-ask`}>
              {t('changeAsk.askButton', { name: am })}
            </button>
          ) : null}
        </div>
      )}

      {pending && (
        <div className="piece-ask-banner is-waiting" role="status" data-testid={`${testId}-waiting`}>
          <div className="piece-ask-banner-text">
            <p className="piece-ask-banner-k">
              {pending.escalatedAt
                ? t('changeAsk.banner.escalated', { name: am, ago: agoText })
                : t('changeAsk.banner.waiting', { name: am, ago: agoText })}
            </p>
            <p className="piece-ask-banner-v" dir="auto">
              {mine
                ? t('changeAsk.banner.youAsked', { what: askedWhat(pending) })
                : t('changeAsk.banner.theyAsked', { who: pending.askedByName ?? '—', what: askedWhat(pending) })}
            </p>
            {seeing && (
              <p className="piece-ask-banner-reason" dir="auto" data-testid={`${testId}-reason`}>
                {pending.kinds.map((k) => t(`changeAsk.kind.${k}`)).join(' · ')} — “{pending.reason}”
              </p>
            )}
          </div>
          <span className="piece-ask-gap" />
          <Button variant="link" size="sm" onClick={() => { setSeeing((s) => !s); setTick((n) => n + 1) }} data-testid={`${testId}-see`}>
            {seeing ? t('changeAsk.hideAsk') : mine ? t('changeAsk.seeYourAsk') : t('changeAsk.seeAsk')}
          </Button>
          {!locked && (
            <Button variant="primary" size="sm" onClick={() => setAnswering(pending)} data-testid={`${testId}-answer`}>
              {t('changeAsk.answer.open')}
            </Button>
          )}
        </div>
      )}

      {answered && (
        <div className={`piece-ask-banner ${answered.status === 'kept' ? 'is-kept' : 'is-accepted'}`} role="status" data-testid={`${testId}-answered`} data-status={answered.status}>
          <div className="piece-ask-banner-text">
            <p className="piece-ask-banner-k">
              {t(`changeAsk.banner.${answered.status}`, {
                name: answered.answeredByName ?? am,
                time: answered.answeredAt ? formatIraqDateTime(answered.answeredAt, loc) : '',
              })}
              {/* Test script step 24: an accepted or changed due date is said in the answer itself. */}
              {answered.status !== 'kept' && answered.appliedDueDay && (
                <span data-testid={`${testId}-answered-due`}>{t('changeAsk.banner.dueNow', { day: day(answered.appliedDueDay) })}</span>
              )}
            </p>
            <p className="piece-ask-banner-v" dir="auto">
              {answered.answerNote ? `“${answered.answerNote}” ` : ''}
              {answered.status === 'kept'
                ? t('changeAsk.banner.keptLine')
                : kindsToMakeInThePiece(answered.kinds).length > 0
                  ? t('changeAsk.banner.inThePiece', { name: answered.answeredByName ?? am })
                  : ''}
            </p>
            {answered.status !== 'kept' && piece && (() => {
              const told = toldNames(piece.tasks, answered.askedBy, answered.answeredBy)
              return told.length > 0 ? (
                <p className="piece-ask-banner-told" data-testid={`${testId}-told`}>{t('changeAsk.banner.told', { names: told.join(', '), count: told.length })}</p>
              ) : null
            })()}
          </div>
          <span className="piece-ask-gap" />
          {answered.status === 'kept' && (
            <Button variant="secondary" size="sm" onClick={() => { markSeen(answered.id); setAsking(true) }} data-testid={`${testId}-reply`}>
              {t('changeAsk.reply')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => { markSeen(answered.id); setTick((n) => n + 1) }} data-testid={`${testId}-ok`}>
            {t('changeAsk.ok')}
          </Button>
        </div>
      )}

      {error && <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>}

      {asking && <ChangeAskDialog deliverableId={deliverableId} onClose={() => setAsking(false)} testId={`${testId}-form`} />}
      {answering && <ChangeAskAnswerDialog ask={answering} onClose={() => setAnswering(null)} testId={`${testId}-answer-dialog`} />}
    </div>
  )
}
