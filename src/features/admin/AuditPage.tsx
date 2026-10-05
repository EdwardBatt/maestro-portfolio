import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { AUDIT_PAGE, useAuditEntities, useAuditEvents, useAuditLookups } from './api/roles-api'
import { actionLabel, actionVariant, entityLabel, formatPayload, resolveEntityName } from './lib/audit-format'
import { auditRecordKey, useAuditRecordNames } from './api/audit-records-api'
import { DateField } from '../../components/DateField'
import { stampFormatter } from '../../lib/time/iraq'

/**
 * Audit trail (L1.11, ADR-0008 Decision 8). Read-only window over the
 * append-only audit_events log — the RLS policy already limits it to
 * audit:view holders in the caller's tenant; there is nothing to edit here
 * by design (the log cannot be changed from the app, pgTAP-proven).
 */
export function AuditPage() {
  const { t, i18n } = useTranslation()
  const [entity, setEntity] = useState<string | null>(null)
  // Both ends optional and independent: "since the 1st" and "up to the 3rd" are each a real
  // question, and requiring the pair would make the common one harder than it is.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const events = useAuditEvents({ entity, from: from || null, to: to || null })
  const entities = useAuditEntities().data ?? []
  const lookups = useAuditLookups().data

  // The pages, flattened. Keyset paging means each is strictly older than the last, so concatenating
  // preserves the order the query asked for.
  const rows = events.data?.pages.flat() ?? []
  // I51.2: the work records on this page, by name and place — "Department brief · Creative — Kite Travel".
  const recordNames = useAuditRecordNames(rows).data

  const fmt = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')

  if (events.isLoading) return <p data-testid="audit-loading">…</p>
  if (events.isError) return <p className="form-error">{t('admin.audit.loadFailed')}</p>

  return (
    <section data-testid="surface-audit">
      {/* Four controls where there was one, so this row wraps where the schedule's does not. */}
      <header className="schedule-bar audit-bar">
        <h1>{t('admin.audit.title')}</h1>
        <label className="audit-filter">
          {t('admin.audit.entity')}
          <select
            value={entity ?? ''}
            onChange={(e) => setEntity(e.target.value || null)}
            data-testid="audit-entity-filter"
          >
            <option value="">{t('admin.audit.allEntities')}</option>
            {/* From the LOG, not from a list somebody typed. The hard-coded fourteen missed every
                table created since August — briefs, templates, concepts, assets — and the screen
                looked complete while doing it. */}
            {entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {entityLabel(e.entity, t)} ({e.eventCount})
              </option>
            ))}
          </select>
        </label>
        <label className="audit-filter">
          {t('admin.audit.from')}
          <DateField value={from} onChange={(v) => setFrom(v)} data-testid="audit-from" />
        </label>
        <label className="audit-filter">
          {t('admin.audit.to')}
          <DateField value={to} onChange={(v) => setTo(v)} data-testid="audit-to" />
        </label>
        {(entity || from || to) && (
          <Button
            variant="link"
            onClick={() => { setEntity(null); setFrom(''); setTo('') }}
            data-testid="audit-clear"
          >
            {t('admin.audit.clear')}
          </Button>
        )}
      </header>

      <p className="muted">{t('admin.audit.intro')}</p>

      {rows.length === 0 ? (
        <p className="muted" data-testid="audit-empty">{t('admin.audit.empty')}</p>
      ) : (
        <table className="data-table" data-testid="audit-table">
          <thead>
            <tr>
              <th>{t('admin.audit.when')}</th>
              <th>{t('admin.audit.actor')}</th>
              <th>{t('admin.audit.action')}</th>
              <th>{t('admin.audit.entity')}</th>
              <th>{t('admin.audit.where')}</th>
              <th>{t('admin.audit.details')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const named = e.entityId ? recordNames?.get(auditRecordKey(e.entity, e.entityId)) : undefined
              const recordName = named?.name || resolveEntityName(e.entity, e.entityId, lookups)
              const pairs = formatPayload(e.payload, lookups, t)
              return (
                <tr key={e.id}>
                  <td className="audit-when">{fmt.format(new Date(e.createdAt))}</td>
                  <td>{e.actorName ?? t('admin.audit.system')}</td>
                  <td><span className={`badge badge-audit-${actionVariant(e.action)}`}>{actionLabel(e.action, t)}</span></td>
                  <td>
                    {entityLabel(e.entity, t)}
                    {recordName ? (
                      <span className="audit-record"> · {recordName}</span>
                    ) : e.entityId ? (
                      <span className="muted"> · {e.entityId.slice(0, 8)}</span>
                    ) : null}
                  </td>
                  <td className="audit-where" data-testid={`audit-where-${e.id}`}>
                    {named?.where ?? <span className="muted">—</span>}
                  </td>
                  <td>
                    {pairs.length === 0 ? (
                      <span className="muted">—</span>
                    ) : pairs.length <= 3 ? (
                      <span className="audit-details">
                        {pairs.map((p, i) => (
                          <span key={p.label + i}>
                            {i > 0 && <span className="muted"> · </span>}
                            <span className="muted">{p.label}:</span> {p.value}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <details className="audit-payload">
                        <summary>{pairs.slice(0, 2).map((p) => `${p.label}: ${p.value}`).join(' · ')} …</summary>
                        <ul className="audit-detail-list">
                          {pairs.map((p, i) => (
                            <li key={p.label + i}><span className="muted">{p.label}:</span> {p.value}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* How far into the log the reader has walked, and the way further in. The count is here
          rather than at the top because it is an answer to what is on screen, not a filter. */}
      {rows.length > 0 && (
        <div className="audit-more">
          <span className="muted" data-testid="audit-count">
            {t('admin.audit.showing', { count: rows.length })}
          </span>
          {events.hasNextPage && (
            <Button variant="primary"
              type="button"
              busy={events.isFetchingNextPage}
              onClick={() => void events.fetchNextPage()}
              data-testid="audit-more"
            >
              {t('admin.audit.loadMore', { count: AUDIT_PAGE })}
            </Button>
          )}
          {/* The end of the log is worth saying. Silence there reads as a screen that has stopped
              working rather than one that has run out of history. */}
          {!events.hasNextPage && (
            <span className="muted" data-testid="audit-end">{t('admin.audit.end')}</span>
          )}
        </div>
      )}
    </section>
  )
}
