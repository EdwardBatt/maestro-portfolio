import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../components/Button'
import { useAuth } from '../../app/auth-context'
import {
  useAddTaskResource,
  useBookableResources,
  useRemoveTaskResource,
  useTaskResources,
  type RequirementReport,
} from './api/task-resources-api'
import { DateField } from '../../components/DateField'
import { formatCalendarDay } from '../../lib/time/iraq'

/**
 * What a task NEEDS (ADR-0042) — the camera, the edit suite, the second pair of hands.
 *
 * ONE editor, THREE places (ADR-0042 d.7, amended 26 Aug): the Deliverables task list, the
 * schedule's edit-booking modal, and the new-task dialog. Deliberately one implementation — three
 * would drift in what they permit and what they record, and this is a write path with an RLS gate
 * behind it.
 *
 * The split is only about WHERE the rows live, never about how they look:
 *   * `TaskResources`       — connected. The task exists, so rows are read and written live.
 *   * `StagedTaskResources` — the task does NOT exist yet (the "+" dialog), so rows are held in the
 *     caller's state and written after the task is created. A requirement keys on `sub_task_id`;
 *     there is nothing to hang it on until the task is real.
 *
 * Requirements are HOURS, not days (d.3). A camera wanted for three hours occupies three hours; the
 * older `days` shape blocked the studio until home time and made the grid report it unavailable when
 * it was free.
 */

/** A row as the editor renders it, whether it is live or still only staged. */
export interface EditorRow {
  /** DB id when live; the resource id when staged. Only used as a key and for removal. */
  id: string
  resourceName: string
  resourceKind: 'human' | 'equipment' | 'room'
  hours: number
  startsOn: string | null
}

export interface AddArgs {
  resourceId: string
  hours: number
  startsOn: string | null
}

/**
 * The editor itself. Presentation only — it takes rows and callbacks and knows nothing about
 * queries, which is what lets the same UI serve a saved task and an unsaved one.
 */
function TaskResourceEditor({
  rows,
  options,
  canManage,
  compact,
  busy,
  report,
  failed,
  onAdd,
  onRemove,
  testIdSuffix,
}: {
  rows: EditorRow[]
  options: { id: string; name: string; kind: EditorRow['resourceKind'] }[]
  canManage: boolean
  compact?: boolean
  busy?: boolean
  report?: RequirementReport | null
  failed?: string | null
  onAdd: (args: AddArgs) => void
  onRemove: (id: string) => void
  testIdSuffix: string
}) {
  const { t } = useTranslation()
  const [resourceId, setResourceId] = useState('')
  const [hours, setHours] = useState('')
  const [startsOn, setStartsOn] = useState('')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = Number(hours)
    if (!resourceId || !(parsed > 0)) return
    onAdd({ resourceId, hours: parsed, startsOn: startsOn || null })
    setResourceId('')
    setHours('')
    setStartsOn('')
  }

  return (
    <section className={`task-resources${compact ? ' compact' : ''}`} data-testid={`task-resources-${testIdSuffix}`}>
      <h4>{t('taskResources.heading')}</h4>

      {rows.length === 0 ? (
        <p className="muted">{t('taskResources.none')}</p>
      ) : (
        <ul className="task-resource-list">
          {rows.map((r) => (
            <li key={r.id} data-testid={`task-resource-${r.id}`}>
              <span className="tr-name">{r.resourceName}</span>
              <span className="muted">{t(`taskResources.kind.${r.resourceKind}`)}</span>
              <span className="tr-hours">{t('taskResources.hoursValue', { hours: r.hours })}</span>
              <span className="muted">{r.startsOn ? formatCalendarDay(r.startsOn) : t('taskResources.fromTaskStart')}</span>
              {canManage && (
                <IconButton
                  icon="close"
                  danger
                  size="sm"
                  label={t('taskResources.remove')}
                  disabled={busy}
                  onClick={() => onRemove(r.id)}
                  data-testid={`task-resource-remove-${r.id}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        // NOT a <form>: on the new-task dialog this editor sits INSIDE the booking form, and a
        // nested form is invalid HTML — the inner submit would post the outer one and create the
        // task early. A div plus an explicit button keeps both flows honest.
        <div className="task-resource-add" data-testid={`task-resource-add-${testIdSuffix}`}>
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            aria-label={t('taskResources.resourceLabel')}
            data-testid="task-resource-picker"
          >
            <option value="">{t('taskResources.selectResource')}</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {t(`taskResources.kind.${r.kind}`)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={t('taskResources.hoursPlaceholder')}
            aria-label={t('taskResources.hoursLabel')}
            data-testid="task-resource-hours"
          />
          <DateField
           
            value={startsOn}
            onChange={(v) => setStartsOn(v)}
            aria-label={t('taskResources.startsOnLabel')}
            title={t('taskResources.startsOnHint')}
            data-testid="task-resource-starts-on"
          />
          <Button variant="primary"
            type="button"
            busy={busy}
            disabled={!resourceId || !(Number(hours) > 0)}
            onClick={submit}
            data-testid="task-resource-add-submit"
          >
            {t('taskResources.add')}
          </Button>
        </div>
      )}

      {failed && <p className="form-error" data-testid="task-resource-error">{failed}</p>}
      {report && <RequirementOutcome report={report} />}
    </section>
  )
}

/** Live editor for a task that exists. Reads and writes immediately, re-materialising each change. */
export function TaskResources({
  subTaskId,
  canManage,
  compact = false,
}: {
  subTaskId: string
  /** The DB is the real gate (RLS); this only decides whether to offer the controls. */
  canManage: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const list = useTaskResources(subTaskId)
  const resources = useBookableResources()
  const add = useAddTaskResource(subTaskId, claims.tenantId)
  const remove = useRemoveTaskResource(subTaskId)

  const [report, setReport] = useState<RequirementReport | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const rows = list.data ?? []
  const taken = new Set(rows.map((r) => r.resourceId))

  if (list.isLoading) return <p className="muted">{t('common.working')}</p>
  if (list.isError) return <p className="form-error">{t('taskResources.loadFailed')}</p>

  return (
    <TaskResourceEditor
      testIdSuffix={subTaskId}
      rows={rows.map((r) => ({
        id: r.id,
        resourceName: r.resourceName,
        resourceKind: r.resourceKind,
        hours: r.hours,
        startsOn: r.startsOn,
      }))}
      // A resource can only be required once per task — two cameras means two camera resources (d.1).
      options={(resources.data ?? []).filter((r) => !taken.has(r.id))}
      canManage={canManage}
      compact={compact}
      busy={add.isPending || remove.isPending}
      report={report}
      failed={failed}
      onAdd={(args) => {
        setFailed(null)
        setReport(null)
        add.mutate(args, {
          onSuccess: (res) => setReport(res.report),
          // 42501 is RLS refusing the write — the viewer may not manage this task. Say so plainly
          // rather than leaving a control that appears to have done nothing.
          onError: (e) => setFailed(t('taskResources.addFailed', { message: (e as Error).message })),
        })
      }}
      onRemove={(id) => remove.mutate({ id }, { onSuccess: (res) => setReport(res.report) })}
    />
  )
}

/**
 * Editor for a task that does not exist yet. Holds nothing itself — the caller owns the rows, since
 * it is the caller that will write them once the task has an id.
 */
export function StagedTaskResources({
  rows,
  onChange,
  compact = false,
}: {
  rows: AddArgs[]
  onChange: (rows: AddArgs[]) => void
  compact?: boolean
}) {
  const resources = useBookableResources()
  const byId = new Map((resources.data ?? []).map((r) => [r.id, r]))
  const taken = new Set(rows.map((r) => r.resourceId))

  return (
    <TaskResourceEditor
      testIdSuffix="new"
      rows={rows.map((r) => ({
        id: r.resourceId,
        resourceName: byId.get(r.resourceId)?.name ?? r.resourceId,
        resourceKind: byId.get(r.resourceId)?.kind ?? 'equipment',
        hours: r.hours,
        startsOn: r.startsOn,
      }))}
      options={(resources.data ?? []).filter((r) => !taken.has(r.id))}
      canManage
      compact={compact}
      onAdd={(args) => onChange([...rows, args])}
      onRemove={(id) => onChange(rows.filter((r) => r.resourceId !== id))}
    />
  )
}

/**
 * What the scheduler actually managed. Silence here would be the worst outcome: the requirement
 * would look booked when it was contested or never placed at all.
 */
function RequirementOutcome({ report }: { report: RequirementReport }) {
  const { t } = useTranslation()
  const clean =
    report.contested.length === 0 && report.overCapacity.length === 0 && report.unplaced.length === 0
  if (clean) {
    return (
      <p className="muted" data-testid="requirement-outcome">
        {t('taskResources.booked', { count: report.placed })}
      </p>
    )
  }
  return (
    <div className="requirement-outcome" data-testid="requirement-outcome">
      {report.contested.length > 0 && (
        <p className="warning-text">{t('taskResources.contested', { names: report.contested.join(', ') })}</p>
      )}
      {report.overCapacity.length > 0 && (
        <p className="warning-text">{t('taskResources.overCapacity', { names: report.overCapacity.join(', ') })}</p>
      )}
      {report.unplaced.map((u) => (
        <p className="error-text" key={u.resource}>
          {t('taskResources.unplaced', { name: u.resource, reason: u.reason })}
        </p>
      ))}
    </div>
  )
}
