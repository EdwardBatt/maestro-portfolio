import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../app/permissions'
import { useFeedbackSubmissions, useResolveFeedback, type FeedbackRow } from './api/feedback-api'
import { Button } from '../../components/Button'
import { stampFormatter } from '../../lib/time/iraq'

/**
 * Power-Admin feedback screen (alpha launch). A window over app_feedback — RLS
 * limits reads to admin.feedback:view holders in the caller's tenant. Newest
 * first. Category is a colour-coded badge; the page + version travel alongside
 * for triage. Holders of admin.feedback:manage can additionally mark an item
 * resolved with an action-taken note, or reopen it — writes go through RLS +
 * the server-side triage guard (feedback content stays immutable).
 */
export function FeedbackAdminPage() {
  const { t, i18n } = useTranslation()
  const { can } = usePermissions()
  const feedback = useFeedbackSubmissions()
  const resolve = useResolveFeedback()
  const canManage = can('admin.feedback:manage')

  // The row currently being resolved (inline note editor) + its draft note.
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const fmt = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')

  if (feedback.isLoading) return <p data-testid="feedback-loading">…</p>
  if (feedback.isError) return <p className="form-error">{t('admin.feedback.loadFailed')}</p>

  function openResolve(id: string) {
    setResolvingId(id)
    setNote('')
  }
  async function submitResolve(id: string) {
    await resolve.mutateAsync({ id, status: 'resolved', resolutionNote: note })
    setResolvingId(null)
    setNote('')
  }
  function reopen(row: FeedbackRow) {
    resolve.mutate({ id: row.id, status: 'open' })
  }

  return (
    <section data-testid="surface-feedback">
      <h1>{t('admin.feedback.title')}</h1>
      <p className="muted">{t('admin.feedback.intro')}</p>

      {(feedback.data?.length ?? 0) === 0 ? (
        <p className="muted" data-testid="feedback-empty">{t('admin.feedback.empty')}</p>
      ) : (
        <table className="data-table" data-testid="feedback-table">
          <thead>
            <tr>
              <th>{t('admin.feedback.when')}</th>
              <th>{t('admin.feedback.submitter')}</th>
              <th>{t('admin.feedback.category')}</th>
              <th>{t('admin.feedback.page')}</th>
              <th>{t('admin.feedback.message')}</th>
              <th>{t('admin.feedback.status')}</th>
              {canManage && <th>{t('admin.feedback.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {feedback.data!.map((f) => {
              const isResolving = resolvingId === f.id
              return (
                <tr key={f.id} data-testid={`feedback-row-${f.id}`} className={f.status === 'resolved' ? 'row-resolved' : ''}>
                  <td className="audit-when">{fmt.format(new Date(f.createdAt))}</td>
                  <td>{f.submitterName ?? t('admin.audit.system')}</td>
                  <td>
                    <span className={`badge badge-feedback-${f.category}`}>
                      {t(`feedback.category_${f.category}`)}
                    </span>
                  </td>
                  <td className="muted">
                    {f.pagePath ?? '—'}
                    {f.appVersion && <span> · {f.appVersion}</span>}
                  </td>
                  <td className="feedback-message">
                    {f.message}
                    {f.status === 'resolved' && (
                      <div className="feedback-resolution" data-testid={`feedback-resolution-${f.id}`}>
                        <span className="feedback-resolution-label">{t('admin.feedback.actionTaken')}</span>
                        <span>{f.resolutionNote || t('admin.feedback.noNote')}</span>
                        {(f.resolverName || f.resolvedAt) && (
                          <span className="muted feedback-resolution-meta">
                            {t('admin.feedback.resolvedBy', {
                              name: f.resolverName ?? t('admin.audit.system'),
                              when: f.resolvedAt ? fmt.format(new Date(f.resolvedAt)) : '',
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge badge-feedback-status-${f.status}`}
                      data-testid={`feedback-status-${f.id}`}
                    >
                      {t(`admin.feedback.status_${f.status}`)}
                    </span>
                  </td>
                  {canManage && (
                    <td className="feedback-actions">
                      {isResolving ? (
                        <div className="feedback-resolve-form">
                          <label className="sr-only" htmlFor={`resolve-note-${f.id}`}>
                            {t('admin.feedback.actionTaken')}
                          </label>
                          <textarea
                            id={`resolve-note-${f.id}`}
                            className="feedback-note-input"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={t('admin.feedback.notePlaceholder')}
                            maxLength={4000}
                            rows={3}
                            data-testid={`feedback-note-${f.id}`}
                          />
                          <div className="feedback-resolve-actions">
                            <Button
                              variant="link"
                              onClick={() => setResolvingId(null)}
                              data-testid={`feedback-cancel-${f.id}`}
                            >
                              {t('admin.feedback.cancel')}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={resolve.isPending}
                              onClick={() => submitResolve(f.id)}
                              data-testid={`feedback-confirm-${f.id}`}
                            >
                              {t('admin.feedback.markResolved')}
                            </Button>
                          </div>
                        </div>
                      ) : f.status === 'open' ? (
                        <Button
                          
                          variant="secondary"
                          
                          onClick={() => openResolve(f.id)}
                          data-testid={`feedback-resolve-${f.id}`}
                        >
                          {t('admin.feedback.resolve')}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary" size="sm" icon="undo"
                          disabled={resolve.isPending}
                          onClick={() => reopen(f)}
                          data-testid={`feedback-reopen-${f.id}`}
                        >
                          {t('admin.feedback.reopen')}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
