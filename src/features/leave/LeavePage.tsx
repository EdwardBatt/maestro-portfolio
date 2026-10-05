import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../app/permissions'
import {
  useDeleteClosure,
  useDeleteLeave,
  useLeaveEntries,
  useOfficeClosures,
  type LeaveEntry,
  type OfficeClosure,
} from './api/leave-api'
import { LeaveDialog } from './LeaveDialog'
import { ClosureDialog } from './ClosureDialog'
import { StrandedWorkPanel } from './StrandedWorkPanel'
import { NoticeDialog } from '../../components/Notice'
import { Button, IconButton, DeleteButton } from '../../components/Button'
import { formatCalendarDay } from '../../lib/time/iraq'

/** timestamptz ISO → display date (YYYY-MM-DD). */
// I66.8: "Fri, 9 Oct", as every date reads.
const fmtDate = (iso: string) => formatCalendarDay(iso.slice(0, 10))

/**
 * The HR surface (ADR-0079 d.7): staff leave AND office closures, on one page, kept separate
 * underneath because they are different facts.
 *
 * Leave (L1.7, ADR-0013) is per person — `resource_unavailability` rows that shade the person's
 * row on the grid. A closure (ADR-0079) is per OFFICE — a public holiday or a company-closed day
 * that shades every row in that office exactly as a weekend does, and covers people hired after it
 * was entered. Both gated by `leave:view`; writes need `leave:manage` and are audited by trigger.
 * Declaring a closure moves no booking; the stranded list underneath is where those get fixed.
 */
export function LeavePage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canManage = can('leave:manage')
  const entries = useLeaveEntries()
  const closures = useOfficeClosures()
  const deleteLeave = useDeleteLeave()
  const deleteClosure = useDeleteClosure()

  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; entry: LeaveEntry } | null>(null)
  const [closureDialog, setClosureDialog] = useState<{ mode: 'create' } | { mode: 'edit'; entry: OfficeClosure } | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [armedClosureId, setArmedClosureId] = useState<string | null>(null)
  /** The closure just saved, whose stranded work is being shown (d.6). */
  const [stranded, setStranded] = useState<{ id: string; name: string } | null>(null)

  const ok = (key: string) => setBanner({ kind: 'ok', text: t(key) })
  const fail = (err: unknown) => {
    const code = (err as { code?: string }).code
    setBanner({ kind: 'error', text: t(code === '42501' ? 'leave.notPermitted' : 'leave.saveFailed') })
  }

  function onDelete(e: LeaveEntry) {
    if (armedId !== e.id) { setArmedId(e.id); return }
    setArmedId(null)
    setBanner(null)
    deleteLeave.mutate(e.id, { onSuccess: () => ok('leave.deleted'), onError: fail })
  }

  function onDeleteClosure(c: OfficeClosure) {
    if (armedClosureId !== c.id) { setArmedClosureId(c.id); return }
    setArmedClosureId(null)
    setBanner(null)
    deleteClosure.mutate(c.id, { onSuccess: () => ok('leave.deleted'), onError: fail })
  }

  if (entries.isLoading) return <p data-testid="leave-loading">…</p>
  if (entries.isError) return <p className="form-error">{t('leave.loadFailed')}</p>

  return (
    <section data-testid="surface-leave">
      <header className="schedule-bar">
        <h1>{t('leave.title')}</h1>
        {canManage && (
          <>
            <Button variant="primary" icon="plus" onClick={() => setDialog({ mode: 'create' })} data-testid="leave-add">
              {t('leave.newEntry')}
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setClosureDialog({ mode: 'create' })} data-testid="closure-add">
              {t('leave.closures.new')}
            </Button>
          </>
        )}
      </header>
      <p className="muted">{t('leave.intro')}</p>

      {stranded && (
        <StrandedWorkPanel closureId={stranded.id} closureName={stranded.name} onDismiss={() => setStranded(null)} />
      )}

      {/* ---- Office closures (ADR-0079) ---- */}
      <h2 className="org-section-heading">{t('leave.closures.heading')}</h2>
      <p className="muted">{t('leave.closures.intro')}</p>
      {closures.isError ? (
        <p className="form-error" data-testid="closures-failed">{t('leave.closures.loadFailed')}</p>
      ) : (
        <table className="data-table" data-testid="closures-table">
          <thead>
            <tr>
              <th>{t('leave.closures.office')}</th>
              <th>{t('leave.closures.name')}</th>
              <th>{t('leave.kind')}</th>
              <th>{t('leave.from')}</th>
              <th>{t('leave.to')}</th>
              <th>{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(closures.data ?? []).map((c) => (
              <tr key={c.id} data-testid={`closure-row-${c.id}`}>
                <td>{c.officeName}</td>
                <td>{c.name}</td>
                <td>{t(`leave.closures.kinds.${c.kind}`)}</td>
                <td>{fmtDate(c.startsOn)}</td>
                <td>{fmtDate(c.endsOn)}</td>
                <td className="row-actions">
                  <Button variant="link" onClick={() => setStranded({ id: c.id, name: c.name })} data-testid={`closure-stranded-${c.id}`}>
                    {t('leave.closures.stranded.show')}
                  </Button>
                  {canManage && (
                    <>
                      <IconButton icon="edit" label={t('admin.resources.edit')} onClick={() => setClosureDialog({ mode: 'edit', entry: c })} data-testid={`closure-edit-${c.id}`} />
                      <DeleteButton armed={armedClosureId === c.id} label={t('admin.org.delete')} confirm={t('admin.org.confirmDelete')} disabled={deleteClosure.isPending} onClick={() => onDeleteClosure(c)} data-testid={`closure-delete-${c.id}`} />
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(closures.data ?? []).length === 0 && (
              <tr><td colSpan={6} className="muted" data-testid="closures-empty">{t('leave.closures.empty')}</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* ---- Leave (ADR-0013) ---- */}
      <h2 className="org-section-heading">{t('leave.leaveHeading')}</h2>

      {/* Edward, 29 Aug: an action reports what it did in front of the person, not as
          a strip above the page. Same rule `I12.9` set for the schedule refusal. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="leave-banner"
          onClose={() => setBanner(null)}
        />
      )}

      <table className="data-table" data-testid="leave-table">
        <thead>
          <tr>
            <th>{t('leave.person')}</th>
            <th>{t('leave.kind')}</th>
            <th>{t('leave.category')}</th>
            <th>{t('leave.from')}</th>
            <th>{t('leave.to')}</th>
            <th>{t('leave.reason')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(entries.data ?? []).map((e) => (
            <tr key={e.id} data-testid={`leave-row-${e.id}`}>
              <td>{e.resourceName}</td>
              <td>{t(`leave.kinds.${e.kind}`)}</td>
              <td>{e.category ? t(`leave.categories.${e.category}`) : '—'}</td>
              <td>{fmtDate(e.startsAt)}</td>
              <td>{fmtDate(e.endsAt)}</td>
              <td>{e.reason ?? '—'}</td>
              <td className="row-actions">
                <IconButton icon="edit" label={t('admin.resources.edit')} onClick={() => setDialog({ mode: 'edit', entry: e })} data-testid={`leave-edit-${e.id}`} />
                <DeleteButton armed={armedId === e.id} label={t('admin.org.delete')} confirm={t('admin.org.confirmDelete')} disabled={deleteLeave.isPending} onClick={() => onDelete(e)} data-testid={`leave-delete-${e.id}`} />
              </td>
            </tr>
          ))}
          {(entries.data ?? []).length === 0 && (
            <tr><td colSpan={7} className="muted" data-testid="leave-empty">{t('leave.empty')}</td></tr>
          )}
        </tbody>
      </table>

      {closureDialog && (
        <ClosureDialog
          key={closureDialog.mode === 'edit' ? closureDialog.entry.id : 'create'}
          entry={closureDialog.mode === 'edit' ? closureDialog.entry : null}
          onClose={() => setClosureDialog(null)}
          onSaved={(id, name) => {
            setClosureDialog(null)
            ok('leave.saved')
            // d.6: what now sits on the closed day, straight away — the list is the other half of
            // "nothing moves". Named after the closure just saved (the dialog knows the name on
            // create as well as on edit); the fallback is for a closure saved without one.
            setStranded({ id, name: name || t('leave.closures.thisClosure') })
          }}
          onError={(err) => { setClosureDialog(null); fail(err) }}
        />
      )}

      {dialog && (
        <LeaveDialog
          key={dialog.mode === 'edit' ? dialog.entry.id : 'create'}
          entry={dialog.mode === 'edit' ? dialog.entry : null}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); ok('leave.saved') }}
          onError={(err) => { setDialog(null); fail(err) }}
        />
      )}
    </section>
  )
}
