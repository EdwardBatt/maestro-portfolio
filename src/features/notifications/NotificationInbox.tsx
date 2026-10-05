import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  useNotifications,
  useUnreadCount,
  useMarkRead,
  useMarkAllRead,
  useNotificationsChannel,
  type AppNotification,
} from './api/notifications-api'
import { AssignmentRequestActions } from './AssignmentRequestActions'
import { ChimeSwitch } from './ChimeSwitch'
import { notificationDoor } from '../../lib/notifications/door'
import { notificationTextKey } from '../../lib/notifications/words'
import { Button } from '../../components/Button'
import { stampFormatter } from '../../lib/time/iraq'

/**
 * In-app notification inbox (ADR-0026, I5): a bell with an unread badge in the topbar and a
 * dropdown of recent notifications. Live-subscribed to the caller's inbox topic; each item renders
 * its copy from `type` (i18n) and deep-links to the entity, marking itself read on click.
 */

function href(n: AppNotification): string {
  // I59.45: one table for the bell and the email's button (`src/lib/notifications/door.ts`), so the two
  // cannot drift apart again. The Schedule doors stay here: the email adds the week and the person,
  // which the bell does not have.
  const door = notificationDoor({ id: n.id, type: n.type, entityType: n.entityType, entityId: n.entityId, detail: n.detail ?? null })
  return door ?? '/schedule'
}

/**
 * When the notification arrived (I3.4 / I4.4, same treatment as the review panel and chat).
 *
 * This row used to render `createdAt.slice(0, 10)` — the raw ISO string, which was wrong three ways
 * at once. It ignored the locale entirely, so AR readers got Latin digits in Gregorian order; it
 * printed the **UTC** day, which is the wrong day for anyone whose local day has already turned over
 * or has not yet; and it carried no time at all, so "did this arrive ten minutes ago or yesterday?"
 * — the only question an inbox exists to answer — could not be answered from the inbox.
 *
 * Absolute rather than relative ("2h ago"): relative needs a ticking clock to stay honest, and a
 * stale one is worse than a timestamp, because it reads as fresh.
 */
function useArrivedFormatter() {
  const { i18n } = useTranslation()
  const fmt = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  return (iso: string): string | null => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : fmt.format(d)
  }
}

export function NotificationInbox() {
  const { t } = useTranslation()
  const arrived = useArrivedFormatter()
  const [open, setOpen] = useState(false)
  const notifs = useNotifications()
  const unread = useUnreadCount()
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  useNotificationsChannel()

  const list = notifs.data ?? []
  const count = unread.data ?? 0

  return (
    <div className="notif" data-testid="notif">
      {/* ADR-0113 d.4 (I59.28): the sound switch sits by the bell. */}
      <ChimeSwitch />
      <Button
        variant="link" className="notif-bell"
        aria-label={t('notifications.heading')}
        onClick={() => setOpen((o) => !o)}
        data-testid="notif-bell"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {count > 0 && <span className="notif-badge" data-testid="notif-badge">{count > 9 ? '9+' : count}</span>}
      </Button>

      {open && (
        <div className="notif-panel" data-testid="notif-panel">
          <div className="notif-head">
            <span>{t('notifications.heading')}</span>
            {count > 0 && (
              <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} data-testid="notif-mark-all">
                {t('notifications.markAll')}
              </Button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="muted notif-empty" data-testid="notif-empty">{t('notifications.empty')}</p>
          ) : (
            <ul className="notif-list">
              {list.map((n) => {
                const at = arrived(n.createdAt)
                return (
                <li key={n.id}>
                  <Link
                    to={href(n)}
                    className={`notif-item ${n.readAt ? '' : 'is-unread'}`}
                    onClick={() => { if (!n.readAt) markRead.mutate(n.id); setOpen(false) }}
                    data-testid={`notif-${n.id}`}
                  >
                    <span className="notif-text">
                      {(() => { const w = notificationTextKey(n); return t(w.key, { label: n.label ?? '', ...w.vars }) })()}
                    </span>
                    {at && (
                      <time className="notif-time muted" dateTime={n.createdAt} data-testid={`notif-time-${n.id}`}>{at}</time>
                    )}
                  </Link>
                  {/* ADR-0087 d.11: the inbox is one of the approver's three doors into the same
                      action. Answer opens the Schedule's answer window; the schedule and the task are
                      the other two. */}
                  {n.type === 'assignment_requested' && n.entityType === 'sub_task' && n.entityId && (
                    <AssignmentRequestActions subTaskId={n.entityId} onOpen={() => { if (!n.readAt) markRead.mutate(n.id); setOpen(false) }} />
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
