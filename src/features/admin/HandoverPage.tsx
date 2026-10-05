import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/Button'
import { BackButton } from '../../components/BackButton'
import { PersonPicker } from '../../components/PersonPicker'
import { ReviewerPicker } from '../../components/ReviewerPicker'
import { reviewerPayload, type ReviewerAppointment } from '../../lib/reviewers/task-reviewers'
import type { PickablePerson } from '../../lib/people/rank-people'
import { leadsOfDepartment } from '../../lib/people/leads-of-department'
import { fetchUserNames } from '../../lib/users/user-names'
import { formatIraqDate } from '../../lib/time/iraq'
import { useHandOverItem, useHandoverItems, useLeavingPeople } from './api/handover-api'
import { useAccountManagers } from '../clients/api/clients-api'
import { useAssignableUsers, useDeliverableOwnerCandidates, useReviewers } from '../deliverables/api/deliverables-api'
import { useWorkstreamOwnerCandidates } from '../campaigns/api/workstreams-api'

/**
 * A leaving person's hand-over (ADR-0133, I70.4) — `/people/handover/:userId`.
 *
 * Deactivating somebody takes their access at once and sends their department lead (Traffic Manager and the
 * Power Admins where there is genuinely none) this list: everything they hold that someone must take on, in six
 * groups, only those that apply. Each row is handed to a named person offered by that field's own rule — an
 * account manager from those who may manage accounts, a deliverable's owner from its department's leads
 * (ADR-0128), a workstream's owner from its department's leads, a task from the people who may be given work, a
 * review from the reviewers — and "Hand over" is the same write the field's own page makes. Nobody Leaving is
 * offered (the sources leave them out, `lib/people/leaving.ts`). When the list reaches empty the database
 * completes the deactivation (d.4); the page then says so.
 *
 * Laid out as the other exception lists (`/deliverables/task-lists`): a heading, one line of what this is, a
 * count, a table per group.
 */
type Kind = 'client' | 'campaign' | 'deliverable' | 'workstream' | 'task' | 'review'
const GROUPS: readonly Kind[] = ['client', 'campaign', 'deliverable', 'workstream', 'task', 'review']

interface Row {
  kind: Kind
  itemId: string
  label: string
  context?: string | null
  detail?: unknown
}

/** The department a row's candidates are drawn from, when the row carries one (a deliverable, a workstream). */
const departmentOf = (row: Row): string | null => {
  const d = (row.detail ?? {}) as Record<string, unknown>
  const v = d.department_id ?? d.departmentId
  return typeof v === 'string' ? v : null
}

export function HandoverPage() {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const { userId = '' } = useParams()
  const items = useHandoverItems(userId)
  const leavingPeople = useLeavingPeople()
  const handOver = useHandOverItem()

  const me = (leavingPeople.data ?? []).find((p) => p.id === userId) ?? null
  // Once the deactivation completes the person is no longer Leaving — their name still heads the page.
  const name = useQuery({
    queryKey: ['handover', 'name', userId],
    enabled: !!userId && !me,
    queryFn: async () => (await fetchUserNames([userId])).get(userId) ?? '',
  })
  const personName = me?.name ?? name.data ?? ''

  const rows = (items.data ?? []) as Row[]
  // What the last hand-over of each row answered (`hand_over_item`): asked of the new person's lead (the item
  // stays), handed over with dates to reschedule, or done. The last one completing shows the completion below.
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})
  const [needsReschedule, setNeedsReschedule] = useState(false)
  const keyOf = (r: Pick<Row, 'kind' | 'itemId'>) => `${r.kind}-${r.itemId}`
  const groups = GROUPS.map((k) => ({ kind: k, rows: rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length > 0)

  return (
    <section data-testid="surface-handover">
      <BackButton fallback={{ path: '/my-work', labelKey: 'back.myWork' }} testId="handover-back" />
      <header className="schedule-bar">
        <h1>{t('handover.title', { name: personName })}</h1>
      </header>
      <p className="muted">
        {me?.leavingSince
          ? t('handover.intro', { date: formatIraqDate(me.leavingSince, loc) })
          : t('handover.introNoDate')}
      </p>

      {items.isError ? (
        <p className="form-error" data-testid="handover-error">{t('handover.loadFailed')}</p>
      ) : items.isLoading ? (
        <p className="muted" data-testid="handover-loading">…</p>
      ) : rows.length === 0 ? (
        <p className="handover-done" data-testid="handover-complete">{t('handover.complete', { name: personName })}</p>
      ) : (
        <>
          <p data-testid="handover-count"><strong>{t('handover.count', { n: rows.length })}</strong></p>
          {handOver.isError && (
            // The database's own reason (e.g. "a reviewer must be appointed for this task") — a generic "could not" left
            // the lead with nothing to act on.
            <p className="form-error" role="alert" data-testid="handover-failed">
              {t('handover.failed')} {(handOver.error as { message?: string } | null)?.message ?? ''}
            </p>
          )}
          {needsReschedule && <p className="muted" role="status" data-testid="handover-reschedule">{t('handover.outcome.reschedule')}</p>}
          {groups.map((g) => (
            <div key={g.kind} className="handover-group" data-testid={`handover-group-${g.kind}`}>
              <h2 className="handover-group-title">{t(`handover.group.${g.kind}`, { n: g.rows.length })}</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(`handover.col.${g.kind}`)}</th>
                    <th>{t('handover.col.context')}</th>
                    <th>{t('handover.col.to')}</th>
                    <th><span className="sr-only">{t('handover.col.action')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <HandoverRow key={keyOf(r)} row={r} leavingId={userId}
                      busy={handOver.isPending}
                      outcome={outcomes[keyOf(r)] ?? null}
                      onHandOver={(toUserId, reviewers) => handOver.mutate({ kind: r.kind, itemId: r.itemId, toUserId, ...(reviewers ? { reviewers } : {}) }, {
                        onSuccess: (res) => {
                          setOutcomes((o) => ({ ...o, [keyOf(r)]: res.outcome === 'requested' ? 'requested' : res.rescheduleNeeded ? 'reschedule' : 'done' }))
                          if (res.rescheduleNeeded) setNeedsReschedule(true)
                        },
                      })} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

/** One item, its picker and its "Hand over". The picker's people follow the field's own rule. */
function HandoverRow({ row, leavingId, busy, outcome, onHandOver }: {
  row: Row; leavingId: string; busy: boolean; outcome: string | null
  onHandOver: (toUserId: string, reviewers?: { user_id: string; is_mandatory: boolean }[]) => void
}) {
  const { t } = useTranslation()
  const [to, setTo] = useState('')
  const people = useCandidates(row, leavingId)
  // A task with no reviewer is asked for one, exactly as the Schedule's assignment dialog asks (ADR-0133 d.3: the
  // field's own rule): the same picker, the same eligible people (reviews:moderate), the same payload.
  const needsReviewer = row.kind === 'task' && (row.detail as { needs_reviewer?: unknown } | undefined)?.needs_reviewer === true
  const reviewerOptions = useReviewers()
  const [reviewers, setReviewers] = useState<ReviewerAppointment[]>([])
  const ready = !!to && (!needsReviewer || reviewers.some((r) => r.isMandatory))
  return (
    <tr data-testid={`handover-row-${row.kind}-${row.itemId}`}>
      <td dir="auto">{row.label}</td>
      <td dir="auto" className="muted">{row.context ?? ''}</td>
      <td>
        <PersonPicker people={people} value={to} onChange={setTo} placeholder={t('handover.pick')}
          testId={`handover-pick-${row.kind}-${row.itemId}`} />
        {needsReviewer && (
          <div className="handover-reviewer" data-testid={`handover-needs-reviewer-${row.itemId}`}>
            <span className="handover-row-note">{t('handover.needsReviewer')}</span>
            <ReviewerPicker options={(reviewerOptions.data ?? []).filter((p) => p.id !== leavingId)} value={reviewers}
              onChange={setReviewers} excludeUserId={to || null} testId={`handover-reviewer-${row.itemId}`} />
          </div>
        )}
      </td>
      <td>
        <Button variant="primary" size="sm" disabled={!ready || busy} onClick={() => onHandOver(to, needsReviewer ? reviewerPayload(reviewers) : undefined)}
          data-testid={`handover-go-${row.kind}-${row.itemId}`}>
          {t('handover.go')}
        </Button>
        {/* A request to the new person's lead leaves the item here until they agree — said on the row. */}
        {outcome === 'requested' && (
          <span className="handover-row-note" role="status" data-testid={`handover-outcome-${row.kind}-${row.itemId}`}>{t('handover.outcome.requested')}</span>
        )}
      </td>
    </tr>
  )
}

/** Who a row may go to — the rule of the field it changes, never the leaving person. */
function useCandidates(row: Row, leavingId: string): PickablePerson[] {
  const managers = useAccountManagers()
  const owners = useDeliverableOwnerCandidates()
  const wsOwners = useWorkstreamOwnerCandidates()
  const assignable = useAssignableUsers()
  const reviewers = useReviewers()
  return useMemo(() => {
    const dept = departmentOf(row)
    const list: { id: string; name: string }[] =
      row.kind === 'client' || row.kind === 'campaign' ? managers.data ?? []
        : row.kind === 'deliverable' ? leadsOfDepartment(owners.data ?? [], dept)
          : row.kind === 'workstream' ? leadsOfDepartment(wsOwners.data ?? [], dept)
            : row.kind === 'task' ? assignable.data ?? []
              : reviewers.data ?? []
    return list.filter((p) => p.id !== leavingId).map((p) => ({ id: p.id, name: p.name }))
  }, [row, leavingId, managers.data, owners.data, wsOwners.data, assignable.data, reviewers.data])
}
