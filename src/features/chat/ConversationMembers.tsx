import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationPerson } from './api/chat-api'
import { Button, IconButton } from '../../components/Button'

/**
 * The two classes of reason, because there are two classes of SUBJECT.
 *
 * **Counted** — the subject is a TASK. "Draft", "Review", "Upload" are workflow-step names
 * (ADR-0052), not things a person recognises, so reading out three of twenty-six is noise dressed
 * as detail. These always count, and the singular says "this task" — the normal case on ad-hoc
 * work, which has exactly one.
 *
 * **Named** — the subject is a DELIVERABLE, a CAMPAIGN, or (for an invitation) a PERSON. Those are
 * real names, and naming them is the point: "owns 60-second hero film" says something that
 * "owns 2 deliverables" does not.
 *
 * Getting this wrong produced the discrepancy Edward reported on 31 Aug — one row reading
 * "created 26 tasks" and the next "created A, B, C" — because the old rule was a blanket
 * "name up to three" that knew nothing about what it was naming.
 *
 * `assigner` is the pre-31-Aug name for `creator`; its copy stays while a browser can still be
 * talking to a `chat` function deployed before the rename.
 */
const COUNTED = new Set(['assignee', 'reviewer', 'creator', 'assigner'])
const NAMED = new Set(['owner', 'account_manager', 'invited'])
const KNOWN = new Set([...COUNTED, ...NAMED])

/** Beyond this many, even a real name is a list nobody reads — fall back to the count. */
const MAX_NAMED = 3

/**
 * What this person is here FOR, named or counted.
 *
 * A reason the copy does not know about must NEVER reach `t()` — i18next returns the key itself, so
 * the screen fills with "chat.reasonMany.assigner". That happened when the deployed function still
 * sent `assigner` after the key was renamed, and it is the same failure as
 * `notifications.type.cancelled` on 26 Aug. Unknown reasons degrade to nothing rather than to debug
 * text; `reason-copy.test.ts` fails the build if a KNOWN one loses its strings.
 */
function why(t: (k: string, o?: Record<string, unknown>) => string, p: ConversationPerson): string {
  const subjects = p.subjects ?? []
  // The count is the server's row count. NEVER the array's length: that array is deduplicated and
  // capped at three, and counting it reported "17 tasks" for 26.
  const n = p.total ?? subjects.length
  // Neither a count nor a subject: an older `chat` function that sends the reason and nothing else.
  // The bare label still says something true, and is better than a blank where a reason should be.
  if (n <= 0) return KNOWN.has(p.reason) ? t(`chat.reason.${p.reason}`) : ''

  if (COUNTED.has(p.reason)) return t(`chat.reasonCount.${p.reason}`, { count: n })

  if (NAMED.has(p.reason)) {
    if (n <= MAX_NAMED && subjects.length > 0)
      return t(`chat.reasonOne.${p.reason}`, { subject: subjects.join(', ') })
    return t(`chat.reasonMany.${p.reason}`, { count: n })
  }

  return ''
}


export function ConversationMembers({
  people,
  canManage,
  addable,
  onAdd,
  onRemove,
  busy,
  lastRemoval,
}: {
  people: ConversationPerson[]
  canManage: boolean
  addable: { id: string; displayName: string }[]
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
  busy: boolean
  /** The last removal's outcome, so "they are still here anyway" can be said rather than implied. */
  lastRemoval: { removed: boolean; stillEntitled: boolean } | null
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState('')
  const present = new Set(people.map((p) => p.userId))
  const candidates = addable.filter((u) => !present.has(u.id))

  return (
    <div className="chat-members" data-testid="chat-members">
      <ul className="chat-member-list">
        {people.length === 0 && (
          <li className="muted" data-testid="chat-members-empty">{t('chat.membersEmpty')}</li>
        )}
        {people.map((p) => (
          <li key={`${p.userId}:${p.reason}`} className="chat-member" data-testid={`chat-member-${p.userId}-${p.reason}`}>
            <span className="chat-member-name">{p.displayName ?? '—'}</span>
            <span className="chat-member-why muted">{why(t, p)}</span>
            {/* Only an invitation can be withdrawn. Somebody the WORK puts here stays, and the
                message below says so rather than letting the button appear to have failed. */}
            {canManage && p.reason === 'invited' && (
              <IconButton
                icon="close"
                danger
                size="sm"
                label={t('chat.removeMember')}
                disabled={busy}
                onClick={() => onRemove(p.userId)}
                data-testid={`chat-member-remove-${p.userId}`}
              />
            )}
          </li>
        ))}
      </ul>

      {lastRemoval?.stillEntitled && (
        <p className="muted" data-testid="chat-remove-still-entitled">{t('chat.stillEntitled')}</p>
      )}

      {canManage && candidates.length > 0 && (
        <form
          className="chat-add-member"
          data-testid="chat-add-member"
          onSubmit={(e) => {
            e.preventDefault()
            if (!adding) return
            onAdd(adding)
            setAdding('')
          }}
        >
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label={t('chat.addMember')}
            data-testid="chat-add-member-select"
          >
            <option value="">{t('chat.addMember')}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
          <Button variant="primary" type="submit" disabled={!adding || busy} data-testid="chat-add-member-submit">
            {t('chat.add')}
          </Button>
        </form>
      )}
    </div>
  )
}
