import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Button } from '../../../components/Button'
import { usePermissions } from '../../../app/permissions'
import { iraqDay } from '../../../lib/time/iraq'
import type { TaskAsk, TimeAsk } from '../../../lib/task-asks/asks'
import { useAsksToAnswer, useTimeAsksFrom, useWithdrawTaskAsk } from '../../../lib/task-asks/api'
import { ChangeAskDialog } from '../../campaigns/components/ChangeAskDialog'
import { useUndoBooking } from '../api/book-api'
import type { ScheduleResource } from '../api/schedule-api'
import { AnswerAskDialog } from './AnswerAskDialog'
import { AskedOfTeamsSection, AsksFromTeamsSection, SeeAskDialog, TimeAsksSection } from './AskPanels'
import { BlockTimeDialog } from './BlockTimeDialog'

/**
 * The Schedule's left column around To book (Figma L SC-01, SC-18, SC-29, SC-30, SC-22): asks from
 * other teams on top; then, below To book, the asks the viewer sent, her makers' asks for more time,
 * and "+ Block time". Each section is absent when empty — a quiet week shows only To book.
 */

/** Top: "Asks from other teams" — the answerer's (SC-29). `?ask=<id>` opens one (My work's door, SC-28). */
export function AsksFromTeamsSlot({ people, onSaid }: { people: ScheduleResource[]; onSaid: (s: string) => void }) {
  const [params, setParams] = useSearchParams()
  const asks = useAsksToAnswer({ live: true })
  const [open, setOpen] = useState<TaskAsk | null>(null)
  const wanted = params.get('ask')
  useEffect(() => {
    if (!wanted || !asks.data) return
    const a = asks.data.find((x) => x.id === wanted)
    if (a) setOpen(a)
    setParams((prev) => { const n = new URLSearchParams(prev); n.delete('ask'); return n }, { replace: true })
  }, [wanted, asks.data, setParams])
  return (
    <>
      <AsksFromTeamsSection asks={asks.data ?? []} onOpen={setOpen} />
      {open && <AnswerAskDialog ask={open} people={people} onClose={() => setOpen(null)} onAnswered={onSaid} />}
    </>
  )
}

const DISMISSED_KEY = 'maestro.schedule.asks.dismissed'
function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
function writeDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s].slice(-200))) } catch { /* a per-viewer convenience only */ }
}

/** Bottom: the viewer's asks (SC-18/SC-30), her makers' asks for more time (SC-01), and Block time (SC-22). */
export function AsksBelowSlot({
  asksSent,
  people,
  blockPeople,
  onSaid,
  onAskAgain,
  seeing,
  onSee,
}: {
  asksSent: TaskAsk[]
  /** the viewer's own people — whose asks for more time she answers */
  people: ScheduleResource[]
  /** whom Block time may be written for — the page's resources */
  blockPeople: ScheduleResource[]
  onSaid: (s: string) => void
  /** open the piece's booking window again for this ask's task */
  onAskAgain: (ask: TaskAsk) => void
  seeing: TaskAsk | null
  onSee: (ask: TaskAsk | null) => void
}) {
  const { t } = useTranslation()
  const perms = usePermissions()
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed())
  const [blocking, setBlocking] = useState(false)
  const [changeFor, setChangeFor] = useState<TimeAsk | null>(null)
  const withdraw = useWithdrawTaskAsk()
  const userIds = useMemo(() => people.map((p) => p.userId).filter((x): x is string => !!x), [people])
  // A team member's own ask is hers to wait on, not to answer — only a lead's view lists them.
  const answersTime = perms.scope === 'team' || perms.scope === 'department' || perms.scope === 'tenant'
  const timeAsks = useTimeAsksFrom(answersTime ? userIds : [], { live: true })
  // ADR-0139 d.7 addendum (Edward, 3 Oct): a lead who books blocks time for her people too — leave included.
  const mayBlock = !perms.ready || perms.can('leave:manage') || perms.can('blackouts:manage') || perms.can('bookings:create')

  const dismiss = (id: string) => setDismissed((s) => { const n = new Set(s).add(id); writeDismissed(n); return n })

  return (
    <>
      <AskedOfTeamsSection asks={asksSent} dismissed={dismissed} onDismiss={dismiss} onSee={onSee} onAskAgain={onAskAgain} onSaid={onSaid} />
      <TimeAsksSection asks={timeAsks.data ?? []} onSaid={onSaid} onPastDue={setChangeFor} />
      {mayBlock && (
        <div className="sc-side-section sc-block-line">
          <Button variant="link" size="sm" onClick={() => setBlocking(true)} data-testid="block-time-open">+ {t('schedule.block.open')}</Button>
        </div>
      )}
      {seeing && (
        <SeeAskDialog ask={seeing} onClose={() => onSee(null)}
          onWithdraw={() => { void withdraw.mutateAsync(seeing.id).then(() => onSaid(t('schedule.asks.sent.withdrawn', { task: seeing.taskTitle }))); onSee(null) }} />
      )}
      {blocking && <BlockTimeDialog people={blockPeople} initialDay={iraqDay(Date.now())} onClose={() => setBlocking(false)} onDone={onSaid} />}
      {changeFor && changeFor.deliverableId && (
        <ChangeAskDialog deliverableId={changeFor.deliverableId} fromSubTaskId={changeFor.subTaskId} initialDueDay={changeFor.toDay}
          onClose={() => setChangeFor(null)} testId="time-ask-change" />
      )}
    </>
  )
}

/**
 * The toast after booking (SC-18): what was booked and asked, who is told, and Undo — the tasks go back
 * to To book and the asks are withdrawn. It goes by itself after a while; the answer is on the grid.
 */
export function UndoToast({ text, undo, onClose }: { text: string; undo: { subTaskIds: string[]; requestIds: string[] } | null; onClose: () => void }) {
  const { t } = useTranslation()
  const run = useUndoBooking()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setTimeout(onClose, 12_000)
    return () => window.clearTimeout(id)
  }, [onClose, text])
  const canUndo = undo != null && (undo.subTaskIds.length > 0 || undo.requestIds.length > 0)
  return (
    <div className="sc-toast" role="status" data-testid="schedule-toast">
      <span className="sc-toast-mark" aria-hidden="true">✓</span>
      <span>{error ?? text}</span>
      {canUndo && !error && (
        <button type="button" className="sc-toast-undo" disabled={run.isPending}
          onClick={() => run.mutate(undo!, { onSuccess: onClose, onError: (e) => setError((e as { message?: string }).message ?? t('schedule.asks.failed')) })}
          data-testid="schedule-toast-undo">{t('schedule.asks.toast.undo')}</button>
      )}
    </div>
  )
}
