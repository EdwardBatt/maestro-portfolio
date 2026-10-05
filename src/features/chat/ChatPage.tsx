import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useMyConversations, type ChatContext, type RailRow } from './api/chat-api'
import { ADHOC, ARCHIVED, buildRail, matches } from './lib/rail'
import { ChatPanel } from './ChatPanel'
import { CampaignRoomHeader } from './CampaignRoomHeader'
import { Button } from '../../components/Button'

/**
 * The chat surface (ADR-0063, I32).
 *
 * Chat had no home: a thread was reachable only from the foot of the deliverable it hung on, so it
 * could be found only by remembering which deliverable that was. There was no list, no unread
 * count, and no way to see that somebody had written to you.
 *
 * **Three columns** — rail, messages, members — the shape Edward asked for and the widely-understood
 * answer to "many rooms, nested, with a visible membership". Structural only: a campaign is not a
 * server you join or leave (membership is derived from the work, ADR-0062), there is no @everyone,
 * no voice, no discovery. The look is Maestro's own.
 *
 * **The rail lists ENTITLED WORK, not existing conversations** (d.2). Rooms are created lazily, so
 * a list of `conversations` would show a handful of rows and read as broken. Opening a row
 * materialises the thread, exactly as the in-context panel already does — and that panel stays
 * where it is (d.4): this screen and the deliverable's own footer show the SAME conversation, never
 * a copy.
 */
export function ChatPage() {
  const { t } = useTranslation()
  const rail = useMyConversations()
  const [params, setParams] = useSearchParams()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  // Off by default: finished work is a record, and the live list should be about live work.
  const [showArchived, setShowArchived] = useState(false)

  const rows = useMemo(() => rail.data ?? [], [rail.data])
  const groups = useMemo(
    () => buildRail(rows.filter((r) => (showArchived || !r.isArchived) && matches(r, query))),
    [rows, query, showArchived],
  )
  const archivedCount = useMemo(() => rows.filter((r) => r.isArchived).length, [rows])
  const searching = query.trim().length > 0

  // The open conversation lives in the URL so a thread can be linked to — which is what a
  // notification's deep link will need, and what makes the back button behave.
  const openType = (params.get('type') as ChatContext | null) ?? null
  const openId = params.get('id')
  const open = rows.find((r) => r.contextType === openType && r.contextId === openId) ?? null

  const select = (r: RailRow) => setParams({ type: r.contextType, id: r.contextId }, { replace: true })

  return (
    <section className="page chat-page" data-testid="surface-chat">
      <header className="page-head">
        <h1>{t('chat.pageHeading')}</h1>
      </header>

      {rail.isError ? (
        <p className="form-error" role="alert" data-testid="chat-rail-failed">{t('chat.railFailed')}</p>
      ) : rail.isLoading ? (
        <p className="muted" data-testid="chat-rail-loading">…</p>
      ) : rows.length === 0 ? (
        // An invitation to act, not a dead end: there is nothing here because there is no work
        // with your name on it, and that is worth saying rather than showing an empty box.
        <div className="empty-state" data-testid="chat-rail-empty"><p>{t('chat.railEmpty')}</p></div>
      ) : (
        <div className="chat-layout">
          <nav className="chat-rail" aria-label={t('chat.pageHeading')} data-testid="chat-rail">
            <div className="chat-rail-tools">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('chat.searchPlaceholder')}
                aria-label={t('chat.searchPlaceholder')}
                data-testid="chat-search"
              />
              {archivedCount > 0 && (
                <Button
                  variant="link"
                  aria-pressed={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                  data-testid="chat-archived-toggle"
                >
                  {t(showArchived ? 'chat.hideArchived' : 'chat.showArchived')}
                </Button>
              )}
            </div>

            {groups.length === 0 && (
              <p className="muted" data-testid="chat-search-none">{t('chat.searchNone')}</p>
            )}

            {groups.map((g) => {
              // While searching, a collapsed group would hide its own hits — so collapse is
              // suspended rather than cleared, and the person's choices survive the search.
              const isCollapsed = searching ? false : (collapsed[g.key] ?? false)
              return (
                <div className="chat-rail-group" key={g.key} data-testid={`chat-group-${g.key}`}>
                  <button
                    type="button"
                    className="chat-group-head"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                    data-testid={`chat-group-toggle-${g.key}`}
                  >
                    <span className="chat-group-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="chat-group-name">
                      {g.key === ADHOC
                        ? t('chat.adhocGroup')
                        : g.key === ARCHIVED
                          ? t('chat.archivedGroup')
                          : g.name ?? t('chat.untitledCampaign')}
                    </span>
                    {/* Collapsed, the count is the only thing telling you there is something in
                        there — so it is on the header, not only on the rows. */}
                    {g.unread > 0 && (
                      <span className="chat-unread" data-testid={`chat-group-unread-${g.key}`}>{g.unread}</span>
                    )}
                  </button>

                  {!isCollapsed && (
                    <ul className="chat-rail-list">
                      {g.room && <RailItem row={g.room} open={open} onSelect={select} isRoom />}
                      {g.threads.map((r) => (
                        <RailItem key={r.contextId} row={r} open={open} onSelect={select} />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="chat-main">
            {open ? (
              <>
                {/* The two questions a person arrives at a campaign room with — how much is done,
                    is anybody on it — answered above the conversation rather than a screen away.
                    Same gauges, same query and same arithmetic as /campaigns/:id. */}
                {open.contextType === 'campaign' && <CampaignRoomHeader campaignId={open.contextId} />}
                {/* The panel carries its own members strip and composer; this screen supplies the
                    navigation around it rather than a second implementation of the thread. */}
                  <ChatPanel
                  key={`${open.contextType}:${open.contextId}`}
                  contextType={open.contextType}
                  contextId={open.contextId}
                  readOnly={open.isArchived}
                />
              </>
            ) : (
              <div className="empty-state" data-testid="chat-none-open"><p>{t('chat.pickOne')}</p></div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function RailItem({
  row,
  open,
  onSelect,
  isRoom = false,
}: {
  row: RailRow
  open: RailRow | null
  onSelect: (r: RailRow) => void
  /** The campaign's own room, labelled as such so it is not mistaken for a deliverable. */
  isRoom?: boolean
}) {
  const { t } = useTranslation()
  const active = open?.contextType === row.contextType && open?.contextId === row.contextId
  return (
    <li>
      <button
        type="button"
        className={`chat-rail-item${active ? ' is-active' : ''}${row.unread > 0 ? ' has-unread' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onSelect(row)}
        data-testid={`chat-rail-${row.contextId}`}
      >
        <span className="chat-rail-title">{isRoom ? t('chat.campaignRoom') : row.title}</span>
        {row.unread > 0 && (
          <span className="chat-unread" data-testid={`chat-unread-${row.contextId}`}>{row.unread}</span>
        )}
      </button>
    </li>
  )
}
