import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { ProgressTip } from '../../../components/DeliverableProgress'
import { formatIraqShortDate, iraqDay, IRAQ_TZ } from '../../../lib/time/iraq'
import { IRAQ_WORKING_CALENDAR, type WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import { timelineBar, timelineWindow, type BarLabel, type BarTone } from '../lib/timeline-bars'

const TONES: readonly BarTone[] = ['delivered', 'approved', 'inProgress', 'inReview', 'notStarted', 'waiting', 'late']

/** A day at midday Iraq time, for formatting a `YYYY-MM-DD` without it slipping a day. */
const noonOf = (day: string) => `${day}T09:00:00Z`

/**
 * The campaign Timeline (Figma CG-06, I57.9): one row per live piece — its code, name and OWNER —
 * and a bar across the working days it has, from its earliest task start (today when none has one)
 * to its due date. *"Friday and Saturday are shaded and never counted. A bar past its due date
 * turns red; a hollow one has nobody on it yet."*
 *
 * Edward, 24 Sep: one bar per PIECE, never per task — the same applies to the timeline as to the
 * Board; pressing a bar opens the piece drawer (CG-04), which shows the breakdown by task.
 *
 * The colour follows the Board's rule (`lib/board-columns.ts`), red when late; the geometry lives in
 * `lib/timeline-bars.ts`. Two weeks are shown, opening three days before today; Previous and Next
 * move a week. The frame's event line is left out (section D rule). `outstandingInputs` is a prop,
 * as on the Board: the page reads `useOutstandingInputs(campaignId)` once for both.
 */
export function CampaignTimeline({
  pieces,
  outstandingInputs,
  onOpenPiece,
  onEditPiece,
  calendar = IRAQ_WORKING_CALENDAR,
  today,
}: {
  pieces: readonly DeliverableRow[]
  outstandingInputs: ReadonlyMap<string, number>
  onOpenPiece: (id: string) => void
  onEditPiece: ((id: string) => void) | null
  /** The office's working days; Sunday–Thursday by default. */
  calendar?: WorkingCalendar
  today?: number
}) {
  const { t, i18n } = useTranslation()
  const now = today ?? Date.now()
  const todayDay = iraqDay(now)
  const [offset, setOffset] = useState(0)
  const days = useMemo(() => timelineWindow(todayDay, offset, calendar), [todayDay, offset, calendar])
  const rows = useMemo(() => {
    const live = pieces.filter((p) => p.state !== 'archived')
    const bars = live.map((p) => ({ piece: p, bar: timelineBar(p, outstandingInputs.get(p.id) ?? 0, days, now, calendar) }))
    // By due date, the soonest first; a piece with no date at the end.
    return bars.sort((a, b) => (a.bar.dueDay ?? '9999').localeCompare(b.bar.dueDay ?? '9999'))
  }, [pieces, outstandingInputs, days, now, calendar])

  const locale = i18n.language === 'ar' ? 'ar' : 'en-GB'
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: IRAQ_TZ, weekday: 'short' })
  const dayNum = new Intl.DateTimeFormat(locale, { timeZone: IRAQ_TZ, day: 'numeric' })
  const labelText = (l: BarLabel) => (l.key === 'late' ? t('campaigns.timeline.bar.late', { count: l.count }) : t(`campaigns.timeline.bar.${l.key}`))
  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }

  return (
    <div role="tabpanel" className="campaign-timeline" data-testid="campaign-panel-timeline">
      <div className="timeline-bar-top">
        <div className="timeline-nav">
          <Button variant="secondary" size="sm" onClick={() => setOffset((o) => o - 1)} data-testid="timeline-prev">
            {t('campaigns.timeline.prev')}
          </Button>
          <span className="timeline-range" data-testid="timeline-range">
            {t('campaigns.timeline.range', { from: formatIraqShortDate(noonOf(days[0].day)), to: formatIraqShortDate(noonOf(days[days.length - 1].day)) })}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setOffset((o) => o + 1)} data-testid="timeline-next">
            {t('campaigns.timeline.next')}
          </Button>
        </div>
        <ul className="timeline-legend" data-testid="timeline-legend">
          {TONES.map((tone) => (
            <li key={tone} className={`is-${tone}`}><span className="timeline-swatch" aria-hidden="true" />{t(`campaigns.timeline.legend.${tone}`)}</li>
          ))}
          <li className="is-hollow"><span className="timeline-swatch" aria-hidden="true" />{t('campaigns.timeline.legend.hollow')}</li>
        </ul>
      </div>

      <div className="timeline-sheet">
        <div className="timeline-row timeline-head">
          <span className="timeline-who" />
          <div className="timeline-track" style={cols}>
            {days.map((d) => (
              <span key={d.day} className={`timeline-day${d.working ? '' : ' is-off'}${d.today ? ' is-today' : ''}`} data-testid={`timeline-day-${d.day}`}>
                {weekday.format(new Date(noonOf(d.day)))} {dayNum.format(new Date(noonOf(d.day)))}
              </span>
            ))}
          </div>
        </div>

        {rows.length === 0 && <p className="timeline-empty">{t('campaigns.timeline.empty')}</p>}

        {rows.map(({ piece: p, bar }) => (
          <div key={p.id} className="timeline-row" data-testid={`timeline-row-${p.id}`}>
            <div className="timeline-who">
              <div className="timeline-piece">
                {p.code && <span className="timeline-code">{p.code}</span>}
                {/* I67.4: the row has no pill — its bar's colour is its status — so the name carries the numbers. */}
                <ProgressTip progress={p.progress} status={t(`campaigns.timeline.legend.${bar.hollow ? 'hollow' : bar.tone}`)} testId={`progress-tip-${p.id}`}>
                  <span className="timeline-name">{p.name}</span>
                </ProgressTip>
              </div>
              <span className="timeline-owner" data-testid={`timeline-owner-${p.id}`}>{p.ownerName ?? t('campaigns.timeline.noOwner')}</span>
              {onEditPiece && (
                <Button variant="link" size="sm" className="timeline-edit" onClick={() => onEditPiece(p.id)} data-testid={`timeline-edit-${p.id}`}>
                  {t('campaigns.timeline.edit')}
                </Button>
              )}
            </div>
            <div className="timeline-track" style={cols}>
              {days.map((d, i) => (
                <span key={d.day} className={`timeline-cell${d.working ? '' : ' is-off'}`} style={{ gridColumn: i + 1, gridRow: 1 }} aria-hidden="true" />
              ))}
              {!bar.dueDay ? (
                <span className="timeline-note" style={{ gridColumn: `1 / ${days.length + 1}`, gridRow: 1 }} data-testid={`timeline-nodue-${p.id}`}>
                  {t('campaigns.timeline.noDue')}
                </span>
              ) : bar.span ? (
                <button
                  type="button"
                  className={`timeline-piece-bar is-${bar.tone}${bar.hollow ? ' is-hollow' : ''}${bar.span.clippedStart ? ' is-clipped-start' : ''}${bar.span.clippedEnd ? ' is-clipped-end' : ''}`}
                  style={{ gridColumn: `${bar.span.from + 1} / ${bar.span.to + 2}`, gridRow: 1 }}
                  onClick={() => onOpenPiece(p.id)}
                  aria-label={t('campaigns.timeline.barAria', {
                    name: p.name,
                    from: formatIraqShortDate(noonOf(bar.startDay)),
                    to: formatIraqShortDate(noonOf(bar.endDay)),
                    count: bar.workingDays,
                  })}
                  data-testid={`timeline-bar-${p.id}`}
                  data-tone={bar.tone}
                  data-hollow={bar.hollow ? 'true' : 'false'}
                >
                  {bar.label && <span className="timeline-bar-label" data-testid={`timeline-label-${p.id}`}>{labelText(bar.label)}</span>}
                </button>
              ) : (
                <span className="timeline-note" style={{ gridColumn: `1 / ${days.length + 1}`, gridRow: 1 }} data-testid={`timeline-outside-${p.id}`}>
                  {t(`campaigns.timeline.${bar.outside === 'before' ? 'before' : 'after'}`, { date: formatIraqShortDate(noonOf(bar.dueDay)) })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="timeline-foot">{t('campaigns.timeline.note')}</p>
    </div>
  )
}
