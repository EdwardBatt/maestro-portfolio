import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import {
  useAddMember,
  useAddablePeople,
  useConversation,
  useConversationChannel,
  useConversationPeople,
  useMarkRead,
  useMessages,
  useRemoveMember,
  useSendMessage,
  type ChatContext,
} from './api/chat-api'
import { ConversationMembers } from './ConversationMembers'
import { Button } from '../../components/Button'
import { dayFormatter } from '../../lib/time/iraq'

/**
 * Why the open call refused, in the caller's words (I31.6, ADR-0062 d.8).
 *
 * `chat.unavailable` — "Chat isn't available here." — was rendered for 403, 404, 500 AND a network
 * failure alike, so a permission refusal, a structural gap and a broken call were indistinguishable
 * to the person looking at them. That is why this looked random for four days.
 */
function unavailableKey(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'forbidden') return 'chat.notYours'
  if (code === 'no_people') return 'chat.nobodyYet'
  if (code === 'not_found') return 'chat.gone'
  return 'chat.unavailable'
}

/**
 * Contextual chat panel (ADR-0015/0027, I4). Drop-in for a campaign room (`contextType="campaign"`)
 * or a work-item thread (`deliverable`/`sub_task`/`review`). Opens (get-or-create + join) the
 * conversation, streams messages live over Broadcast, and sends optimistically with idempotent
 * retry. Membership + authorization are enforced server-side; this is presentation.
 */
export function ChatPanel({
  contextType,
  contextId,
  /** Archived work keeps its discussion as a RECORD: the thread reads, the composer goes (ADR-0063
   *  d.6). Same shape the ad-hoc branch of /deliverables already uses for finished work — shown
   *  read-only rather than hidden, because a discussion nobody can find is a discussion lost. */
  readOnly = false,
}: {
  contextType: ChatContext
  contextId: string
  readOnly?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null

  /**
   * When each message was sent, and which day it belongs to (I3.4's other half).
   *
   * `createdAt` has been carried on every message since I4.1 and rendered nowhere, so a thread was
   * an ordered list with no time in it — you could see that a decision came after a question, never
   * whether the gap between them was four minutes or four days. In a room whose whole purpose is
   * accountability for work (ADR-0062) that gap is most of the meaning.
   *
   * Time-of-day per message, DATE only on a divider when the day changes. Stamping the full date on
   * every line would repeat the same nine characters down a 200-message thread to say nothing new;
   * the divider says it once, where it is actually news. Same `Intl.DateTimeFormat` locale rule as
   * the review panel and the audit log.
   */
  const timeFmt = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar' : 'en-GB', { timeStyle: 'short' })
  const dayFmt = dayFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  /** The day a message belongs to, in the READER's timezone — null if the stamp is unusable. */
  function dayOf(iso: string | null | undefined): string | null {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : dayFmt.format(d)
  }

  const conv = useConversation(contextType, contextId)
  const members = useConversationPeople(contextType, contextId)
  const addable = useAddablePeople()
  const addMember = useAddMember(contextType, contextId)
  const removeMember = useRemoveMember(contextType, contextId)
  const conversationId = conv.data ?? null
  const messages = useMessages(conversationId)
  const send = useSendMessage(conversationId ?? '')
  const markRead = useMarkRead(conversationId ?? '')
  useConversationChannel(conversationId)

  const [text, setText] = useState('')
  const list = messages.data ?? []
  const endRef = useRef<HTMLLIElement>(null)

  // advance the read cursor as new confirmed messages arrive
  const maxSeq = list.reduce((m, x) => (x.seq != null && x.seq > m ? x.seq : m), 0)
  useEffect(() => {
    if (conversationId && maxSeq > 0) markRead.mutate(maxSeq)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, maxSeq])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [list.length])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = text.trim()
    if (!body || !conversationId) return
    send.mutate({ id: crypto.randomUUID(), body })
    setText('')
  }

  return (
    <section className="chat-panel" data-testid="chat-panel">
      <h3>{t('chat.heading')}</h3>
      {conv.isError ? (
        <p className="form-error" data-testid="chat-unavailable">{t(unavailableKey(conv.error))}</p>
      ) : conv.isLoading ? (
        <p className="muted" data-testid="chat-loading">…</p>
      ) : (
        <>
          {/* ADR-0063 d.8: who is in the room, and why, before you write — visible by default and
              not behind a menu. It is also what closes the gap ADR-0062 leaves open: management
              holds `chat_oversight` over every work conversation, and a manager who only reads
              leaves no trace, so being able to SEE them is what makes that defensible. */}
          <ConversationMembers
            people={members.data?.people ?? []}
            canManage={members.data?.canManage ?? false}
            addable={addable.data ?? []}
            onAdd={(id) => addMember.mutate(id)}
            onRemove={(id) => removeMember.mutate(id)}
            busy={addMember.isPending || removeMember.isPending}
            lastRemoval={removeMember.data ?? null}
          />
          <ul className="chat-messages" data-testid="chat-messages">
            {list.length === 0 && <li className="muted" data-testid="chat-empty">{t('chat.empty')}</li>}
            {list.map((mMsg, i) => {
              const day = dayOf(mMsg.createdAt)
              const at = day ? timeFmt.format(new Date(mMsg.createdAt)) : null
              // A divider only where the day actually turns over — so the first message carries one
              // and the next fifty on the same day do not.
              const newDay = day && day !== dayOf(list[i - 1]?.createdAt)
              return (
              <Fragment key={mMsg.id}>
              {newDay && <li className="chat-day muted" data-testid="chat-day">{day}</li>}
              <li
                className={`chat-msg ${mMsg.senderId === myId ? 'is-me' : ''} status-${mMsg.status}`}
                data-testid={`chat-msg-${mMsg.id}`}
              >
                <span className="chat-msg-meta muted">
                  <span>{mMsg.senderName ?? (mMsg.senderId === myId ? t('chat.you') : '—')}</span>
                  {at && <time dateTime={mMsg.createdAt} data-testid={`chat-msg-time-${mMsg.id}`}>{at}</time>}
                </span>
                <span className="chat-msg-body">{mMsg.body}</span>
                {mMsg.status === 'pending' && <span className="chat-msg-state muted"> · {t('chat.sending')}</span>}
                {mMsg.status === 'failed' && (
                  <Button variant="link" className="danger" icon="refresh" onClick={() => send.mutate({ id: mMsg.id, body: mMsg.body })} data-testid={`chat-retry-${mMsg.id}`}>
                    {t('chat.failedRetry')}
                  </Button>
                )}
              </li>
              </Fragment>
              )
            })}
            <li ref={endRef} aria-hidden="true" />
          </ul>
          {readOnly ? (
            <p className="muted" data-testid="chat-read-only">{t('chat.archivedReadOnly')}</p>
          ) : (
          <form className="chat-composer" onSubmit={onSubmit} data-testid="chat-composer">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('chat.placeholder')}
              disabled={!conversationId}
              data-testid="chat-input"
            />
            <Button variant="primary" type="submit" disabled={!text.trim() || !conversationId} data-testid="chat-send">{t('chat.send')}</Button>
          </form>
          )}
        </>
      )}
    </section>
  )
}
