import { useTranslation } from 'react-i18next'
import type { AssignedWorkItem } from '../../api/deliverables-api'
import { groupOf, type NeedsYouDialog, type NeedsYouItem } from '../../lib/needs-you'
import type {
  BlockRow,
  ChangeRequestRow,
  ClientWaitRow,
  ExtensionStepRow,
  MessageRow,
  ScopeRow,
} from '../../lib/needs-you-requests'
import { nudgeDraft } from '../../lib/requests-text'
import { ChangeCostDialog, ChangeCounterDialog, ChangeDecideDialog } from './ChangeRequestDialogs'
import { ExtensionAmDialog, ExtensionOwnerDialog } from './ExtensionDialogs'
import { NudgeDialog } from './NudgeDialog'
import { ReplyDialog } from './ReplyDialog'
import { MarkReceivedDialog, ScopeAckDialog } from './SmallDialogs'
import { TooMuchDialog } from './TooMuchDialog'
import { RequestEyebrowContext } from './request-eyebrow'
import { ChangeAskAnswerDialog } from '../../../campaigns/components/ChangeAskAnswerDialog'
import type { ChangeAskNeedRow } from '../../lib/needs-you-requests'

/**
 * Opens the one dialog a Needs-you button names (plan View 6) on its item — each item's `ref` is
 * the source row its dialog needs. Test ids are `needs-you-<dialog>-…`, one per dialog kind.
 */
/**
 * Every dialog opened from a card carries the card's kind as its eyebrow, coloured by the card's
 * group (Figma NY-*: "BLOCKED · 2H", "EXTENSION · FROM …") — the same words the card shows.
 */
export function NeedsYouDialogHost(props: {
  item: NeedsYouItem
  dialog: NeedsYouDialog
  mode?: string
  meId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const eyebrow = { text: t(`needsYou.kind.${props.item.kind}`), tone: groupOf(props.item.clock) }
  return (
    <RequestEyebrowContext.Provider value={eyebrow}>
      <HostedDialog {...props} />
    </RequestEyebrowContext.Provider>
  )
}

function HostedDialog({
  item,
  dialog,
  mode,
  meId,
  onClose,
}: {
  item: NeedsYouItem
  dialog: NeedsYouDialog
  mode?: string
  meId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  switch (dialog) {
    case 'nudge': {
      const b = item.ref as BlockRow
      return (
        <NudgeDialog
          testId="ny-nudge"
          deliverableId={b.deliverableId}
          subTaskId={b.subTaskId}
          pieceLabel={[b.taskTitle, b.deliverableName].filter(Boolean).join(' · ')}
          suggestedName={b.awaitedFrom}
          draft={nudgeDraft(t, { task: b.taskTitle, what: b.description, maker: b.makerName })}
          onClose={onClose}
        />
      )
    }
    case 'reply': {
      const m = item.ref as MessageRow
      return (
        <ReplyDialog
          testId="ny-reply"
          questionId={m.id}
          askerName={m.authorName}
          question={m.body ?? ''}
          pieceLabel={m.label}
          onClose={onClose}
        />
      )
    }
    case 'too_much': {
      const w = item.ref as AssignedWorkItem
      return <TooMuchDialog testId="ny-too-much" subTaskId={w.subTaskId} taskTitle={w.title} assignerName={w.assignerName} meId={meId} onClose={onClose} />
    }
    case 'extension_owner':
      return (
        <ExtensionOwnerDialog
          testId="ny-ext-owner"
          request={item.ref as ExtensionStepRow}
          initialMode={mode === 'decline' ? 'decline' : 'forward'}
          onClose={onClose}
        />
      )
    case 'extension_am':
      return <ExtensionAmDialog testId="ny-ext-am" request={item.ref as ExtensionStepRow} onClose={onClose} />
    case 'change_decide':
      return <ChangeDecideDialog testId="ny-change-decide" request={item.ref as ChangeRequestRow} onClose={onClose} />
    case 'change_cost':
      return <ChangeCostDialog testId="ny-change-cost" request={item.ref as ChangeRequestRow} onClose={onClose} />
    case 'change_counter':
      return (
        <ChangeCounterDialog
          testId="ny-change-counter"
          request={item.ref as ChangeRequestRow}
          initialMode={mode === 'withdraw' ? 'withdraw' : 'accept_counter'}
          onClose={onClose}
        />
      )
    case 'mark_received': {
      const c = item.ref as ClientWaitRow
      return <MarkReceivedDialog testId="ny-received" inputId={c.inputId} what={c.description} from={c.awaitedFrom} piece={c.deliverableName} onClose={onClose} />
    }
    case 'scope_ack':
      return <ScopeAckDialog testId="ny-scope-ack" job={item.ref as ScopeRow} onClose={onClose} />
    case 'change_ask_answer':
      return (
        <ChangeAskAnswerDialog
          testId="ny-change-ask"
          ask={item.ref as ChangeAskNeedRow}
          initialAnswer={mode === 'keep' ? 'keep' : mode === 'change' ? 'change' : 'accept'}
          onClose={onClose}
        />
      )
  }
}
