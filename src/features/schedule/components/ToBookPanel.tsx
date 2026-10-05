import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { iraqDay } from '../../../lib/time/iraq'
import {
  DUE_FILTERS,
  LONG_WAIT_MS,
  campaignOptions,
  clientOptions,
  filterToBook,
  orderToBook,
  waitingFor,
  type DueFilter,
  type ToBookFilter,
  type ToBookPiece,
} from '../lib/to-book.ts'
import { dayLong } from '../lib/day-words.ts'
import { Popover } from './Popover'

/**
 * "To book" (I74.21, Figma L SC-01 / SC-02 / SC-02b): the pieces with work nobody is on yet, longest
 * waiting first. Pick one, then click a day on someone's row; or drag the card onto the day. Search
 * reads the name, the code, the campaign and the client; the menus narrow by client (with counts),
 * campaign and when it is due.
 */
export function ToBookPanel({
  pieces,
  loading,
  failed,
  pickedId,
  onPick,
  filter,
  onFilter,
}: {
  pieces: ToBookPiece[]
  loading: boolean
  failed: boolean
  pickedId: string | null
  onPick: (piece: ToBookPiece | null) => void
  filter: ToBookFilter
  onFilter: (f: ToBookFilter) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const today = iraqDay(Date.now())
  const [menu, setMenu] = useState<{ kind: 'client' | 'campaign' | 'due'; anchor: HTMLElement } | null>(null)
  const now = Date.now()

  const ordered = useMemo(() => orderToBook(pieces), [pieces])
  const shown = useMemo(() => filterToBook(ordered, filter, today), [ordered, filter, today])
  const clients = useMemo(() => clientOptions(pieces), [pieces])
  const campaigns = useMemo(() => campaignOptions(pieces, filter.clientId), [pieces, filter.clientId])
  const clientName = clients.find((c) => c.id === filter.clientId)?.name
  const campaignName = campaigns.find((c) => c.id === filter.campaignId)?.name

  const waitWords = (since: string) => {
    const w = waitingFor(since, now)
    return t(`schedule.sc.toBook.waiting.${w.unit}`, { n: w.n })
  }

  return (
    <aside className="sc-tobook" aria-labelledby="to-book-title" data-testid="to-book">
      <h2 id="to-book-title" className="sc-tobook-title">
        {t('schedule.sc.toBook.title')} <span className="sc-count" data-testid="to-book-count">{pieces.length}</span>
      </h2>
      <p className="sc-tobook-hint">{pickedId ? t('schedule.sc.toBook.hintPicked') : t('schedule.sc.toBook.hint')}</p>
      <input
        type="search"
        className="sc-search"
        value={filter.query}
        onChange={(e) => onFilter({ ...filter, query: e.target.value })}
        placeholder={t('schedule.sc.toBook.search')}
        aria-label={t('schedule.sc.toBook.search')}
        data-testid="to-book-search"
      />
      <div className="sc-chips">
        <button type="button" className={`sc-chip${filter.clientId ? ' is-on' : ''}`} onClick={(e) => setMenu({ kind: 'client', anchor: e.currentTarget })} data-testid="to-book-client">
          {clientName ?? t('schedule.sc.toBook.allClients')} ▾
        </button>
        <button type="button" className={`sc-chip${filter.campaignId ? ' is-on' : ''}`} onClick={(e) => setMenu({ kind: 'campaign', anchor: e.currentTarget })} data-testid="to-book-campaign">
          {campaignName ?? t('schedule.sc.toBook.allCampaigns')} ▾
        </button>
        <button type="button" className={`sc-chip${filter.due !== 'any' ? ' is-on' : ''}`} onClick={(e) => setMenu({ kind: 'due', anchor: e.currentTarget })} data-testid="to-book-due">
          {t(`schedule.sc.toBook.due.${filter.due}`)} ▾
        </button>
      </div>

      {loading && <p className="muted" data-testid="to-book-loading">…</p>}
      {failed && <p className="form-error" data-testid="to-book-failed">{t('schedule.sc.toBook.failed')}</p>}
      {!loading && !failed && pieces.length === 0 && <p className="sc-empty" data-testid="to-book-empty">{t('schedule.sc.toBook.empty')}</p>}
      {!loading && pieces.length > 0 && shown.length === 0 && <p className="sc-empty" data-testid="to-book-nomatch">{t('schedule.sc.toBook.noMatch')}</p>}

      <ul className="sc-cards">
        {shown.map((p) => {
          const long = now - Date.parse(p.waitingSince) > LONG_WAIT_MS
          const on = p.deliverableId === pickedId
          return (
            <li key={p.deliverableId}>
              <button
                type="button"
                className={`sc-card${on ? ' is-on' : ''}`}
                aria-pressed={on}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/piece-id', p.deliverableId); onPick(p) }}
                onClick={() => onPick(on ? null : p)}
                data-testid={`to-book-${p.deliverableId}`}
              >
                <span className="sc-card-top">
                  <span className="sc-card-client"><span className="sc-dot" aria-hidden="true" />{p.clientName ?? p.campaignName}</span>
                  <span className={`sc-wait${long ? ' is-long' : ''}`}>{waitWords(p.waitingSince)}</span>
                </span>
                <span className="sc-card-name">{p.name}</span>
                <span className="sc-card-meta">
                  {[p.code, p.campaignName, t('schedule.sc.hours', { n: p.hours }), p.dueAt ? t('schedule.sc.toBook.dueOn', { day: dayLong(iraqDay(p.dueAt), lang) }) : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={240} testId={`to-book-${menu.kind}-menu`}>
          <div className="sc-menu">
            {menu.kind === 'client' && (
              <>
                <p className="sc-pop-title">{t('schedule.sc.toBook.onlyTeam')}</p>
                <MenuItem on={!filter.clientId} label={t('schedule.sc.toBook.allClients')} count={pieces.length}
                  onClick={() => { onFilter({ ...filter, clientId: '', campaignId: '' }); setMenu(null) }} testId="to-book-client-all" />
                {clients.map((c) => (
                  <MenuItem key={c.id} on={filter.clientId === c.id} label={c.name} count={c.count}
                    onClick={() => { onFilter({ ...filter, clientId: c.id, campaignId: '' }); setMenu(null) }} testId={`to-book-client-${c.id}`} />
                ))}
              </>
            )}
            {menu.kind === 'campaign' && (
              <>
                <MenuItem on={!filter.campaignId} label={t('schedule.sc.toBook.allCampaigns')} count={campaigns.reduce((n, c) => n + c.count, 0)}
                  onClick={() => { onFilter({ ...filter, campaignId: '' }); setMenu(null) }} testId="to-book-campaign-all" />
                {campaigns.map((c) => (
                  <MenuItem key={c.id} on={filter.campaignId === c.id} label={c.name} count={c.count}
                    onClick={() => { onFilter({ ...filter, campaignId: c.id }); setMenu(null) }} testId={`to-book-campaign-${c.id}`} />
                ))}
              </>
            )}
            {menu.kind === 'due' && DUE_FILTERS.map((d: DueFilter) => (
              <MenuItem key={d} on={filter.due === d} label={t(`schedule.sc.toBook.due.${d}`)}
                onClick={() => { onFilter({ ...filter, due: d }); setMenu(null) }} testId={`to-book-due-${d}`} />
            ))}
          </div>
        </Popover>
      )}
    </aside>
  )
}

function MenuItem({ on, label, count, onClick, testId }: { on: boolean; label: string; count?: number; onClick: () => void; testId: string }) {
  return (
    <button type="button" className={`sc-menu-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onClick} data-testid={testId}>
      <span>{label}</span>
      {count != null && <span className="sc-menu-count">{count}</span>}
    </button>
  )
}
