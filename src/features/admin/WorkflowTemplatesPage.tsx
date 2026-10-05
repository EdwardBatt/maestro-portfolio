import { NoticeDialog } from '../../components/Notice'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../lib/review/review-mode'
import { Button, IconButton } from '../../components/Button'
import {
  useCreateWorkflowStep,
  useCreateWorkflowTemplate,
  useDeleteWorkflowStep,
  useResequenceWorkflowSteps,
  useSaveWorkflowStep,
  useSaveWorkflowTemplate,
  useWorkflowSteps,
  useWorkflowTemplates,
  type WorkflowStep,
  type WorkflowTemplate,
} from './api/workflow-templates-api'

/**
 * Admin → Workflow templates (ADR-0052, I19.12).
 *
 * A template is an ordered checklist of WORK a deliverable type implies — "Storyboard", "Rough
 * Cut", "Prepress". It names activities and never a person, a department, a team or a role
 * (ADR-0052 d.1). That restraint is the reason these can be seeded at all where `work_types` could
 * not be: who does the work is decided by a human at assignment time, and nothing shipped by a
 * vendor gets an opinion about how an agency is structured.
 *
 * The tenant starts with 14 templates and 154 steps and owns them outright — rename them, add
 * steps, add templates of their own. Seeded rows are marked, because a later seed refresh finds its
 * own rows by that flag and an admin renaming one should know it.
 *
 * **Deactivate, never delete.** A materialised task keeps a `workflow_step_id`, so a step is a
 * record of what a job was broken into. Deactivating removes it from future materialisation and
 * leaves every task already created by it intact.
 *
 * Which type USES which template is set on Admin → Deliverable types; this screen is the templates
 * themselves. Both halves shipped together in I19.11/I19.12, having been missing since 28 Aug.
 */
export function WorkflowTemplatesPage() {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const templates = useWorkflowTemplates()
  const steps = useWorkflowSteps()
  const saveTemplate = useSaveWorkflowTemplate()
  const createTemplate = useCreateWorkflowTemplate()
  const saveStep = useSaveWorkflowStep()
  const createStep = useCreateWorkflowStep()
  const deleteStep = useDeleteWorkflowStep()
  const resequence = useResequenceWorkflowSteps()

  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null)
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState({ code: '', nameEn: '', nameAr: '' })
  const [newStep, setNewStep] = useState<{ titleEn: string; titleAr: string; hours: string; reviewMode: ReviewMode }>({ titleEn: '', titleAr: '', hours: '', reviewMode: 'digital' })

  const stepsByTemplate = useMemo(() => {
    const map = new Map<string, WorkflowStep[]>()
    for (const s of steps.data ?? []) map.set(s.templateId, [...(map.get(s.templateId) ?? []), s])
    return map
  }, [steps.data])

  function fail(e: unknown, fallback: string) {
    setError((e as { message?: string })?.message || fallback)
  }

  if (templates.isError || steps.isError) {
    return (
      <section className="page">
        <p className="form-error" data-testid="workflow-templates-error">
          {t('admin.workflowTemplates.loadFailed')}
        </p>
      </section>
    )
  }

  const list = templates.data ?? []

  function onAddTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!claims.tenantId || !newTemplate.code.trim() || !newTemplate.nameEn.trim()) return
    createTemplate.mutate(
      {
        tenantId: claims.tenantId,
        code: newTemplate.code,
        nameEn: newTemplate.nameEn,
        nameAr: newTemplate.nameAr || null,
      },
      {
        onSuccess: () => { setNewTemplate({ code: '', nameEn: '', nameAr: '' }); setError(null) },
        onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')),
      },
    )
  }

  function onAddStep(templateId: string) {
    if (!claims.tenantId || !newStep.titleEn.trim()) return
    const existing = stepsByTemplate.get(templateId) ?? []
    // Append. `uq_workflow_steps_tenant_template_order` makes the position unique, so the next
    // number has to come from the highest that exists, not from the count — a template with a
    // deleted middle step would otherwise collide.
    const nextOrder = existing.reduce((n, s) => Math.max(n, s.sortOrder), 0) + 1
    createStep.mutate(
      {
        tenantId: claims.tenantId,
        templateId,
        sortOrder: nextOrder,
        titleEn: newStep.titleEn,
        titleAr: newStep.titleAr || null,
        defaultHours: newStep.hours ? Number(newStep.hours) : null,
        reviewMode: newStep.reviewMode,
      },
      {
        onSuccess: () => { setNewStep({ titleEn: '', titleAr: '', hours: '', reviewMode: 'digital' }); setError(null) },
        onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')),
      },
    )
  }

  function move(templateId: string, stepId: string, dir: -1 | 1) {
    const ordered = (stepsByTemplate.get(templateId) ?? []).map((s) => s.id)
    const from = ordered.indexOf(stepId)
    const to = from + dir
    if (from < 0 || to < 0 || to >= ordered.length) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved as string)
    resequence.mutate(
      { orderedIds: next },
      { onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')) },
    )
  }

  return (
    <section className="page" data-testid="surface-workflow-templates">
      <header className="page-head">
        <h1>{t('admin.workflowTemplates.title')}</h1>
        <p className="muted">{t('admin.workflowTemplates.intro')}</p>
      </header>

      {error && (
        <NoticeDialog kind="error" message={error} testId="workflow-save-error" onClose={() => setError(null)} />
      )}

      {templates.isLoading ? (
        <p className="muted" data-testid="workflow-loading">…</p>
      ) : list.length === 0 ? (
        <div className="empty-state" data-testid="workflow-empty">
          <p>{t('admin.workflowTemplates.empty')}</p>
        </div>
      ) : (
        <table className="data-table" data-testid="workflow-templates-table">
          <thead>
            <tr>
              <th>{t('admin.workflowTemplates.code')}</th>
              <th>{t('admin.workflowTemplates.nameEn')}</th>
              <th>{t('admin.workflowTemplates.nameAr')}</th>
              <th>{t('admin.workflowTemplates.steps')}</th>
              <th>{t('admin.deliverableTypes.status')}</th>
              <th aria-label={t('admin.users.actions')} />
            </tr>
          </thead>
          <tbody>
            {list.map((w) => {
              const mine = stepsByTemplate.get(w.id) ?? []
              const live = mine.filter((s) => s.isActive)
              const isOpen = openId === w.id
              return [
                <tr key={w.id} data-testid={`workflow-template-${w.code}`} className={w.isActive ? '' : 'is-inactive'}>
                  <td>
                    <code>{w.code}</code>
                    {/* A seeded row. Said plainly, because a later seed refresh finds its own rows
                        by this flag and a rename here is a decision, not a typo fix. */}
                    {w.isSystem && (
                      <span className="muted" title={t('admin.workflowTemplates.systemHint')}>
                        {' '}· {t('admin.workflowTemplates.system')}
                      </span>
                    )}
                  </td>
                  <td>
                    {editing?.id === w.id ? (
                      <input
                        value={editing.nameEn}
                        onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                        data-testid="workflow-edit-name-en"
                      />
                    ) : (
                      w.nameEn
                    )}
                  </td>
                  <td dir="rtl">
                    {editing?.id === w.id ? (
                      <input
                        value={editing.nameAr ?? ''}
                        onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
                        data-testid="workflow-edit-name-ar"
                      />
                    ) : (
                      w.nameAr || <span className="muted">{t('admin.deliverableTypes.noArabic')}</span>
                    )}
                  </td>
                  <td>{t('admin.workflowTemplates.stepCount', { n: live.length })}</td>
                  <td>
                    {w.isActive
                      ? t('admin.deliverableTypes.active')
                      : <span className="muted">{t('admin.deliverableTypes.inactive')}</span>}
                  </td>
                  <td className="row-actions">
                    {editing?.id === w.id ? (
                      <>
                        <Button variant="primary"
                          busy={saveTemplate.isPending}
                          onClick={() =>
                            saveTemplate.mutate(
                              { id: editing.id, nameEn: editing.nameEn, nameAr: editing.nameAr },
                              {
                                onSuccess: () => { setEditing(null); setError(null) },
                                onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')),
                              },
                            )
                          }
                          data-testid="workflow-edit-save"
                        >
                          {t('common.save')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditing(null)} data-testid="workflow-edit-cancel">
                          {t('common.cancel')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="link"
                          aria-expanded={isOpen}
                          onClick={() => setOpenId(isOpen ? null : w.id)}
                          data-testid={`workflow-open-${w.code}`}
                        >
                          {isOpen ? t('admin.workflowTemplates.hideSteps') : t('admin.workflowTemplates.showSteps')}
                        </Button>
                        <IconButton icon="edit" label={t('admin.deliverableTypes.rename')} onClick={() => setEditing(w)} data-testid={`workflow-rename-${w.code}`} />
                        <Button
                          variant="secondary" size="sm"
                          onClick={() =>
                            saveTemplate.mutate(
                              { id: w.id, isActive: !w.isActive },
                              { onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')) },
                            )
                          }
                          data-testid={`workflow-toggle-${w.code}`}
                        >
                          {w.isActive ? t('admin.deliverableTypes.deactivate') : t('admin.deliverableTypes.reactivate')}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>,

                isOpen ? (
                  <tr key={`${w.id}-steps`} data-testid={`workflow-steps-${w.code}`}>
                    <td colSpan={6}>
                      <div className="workflow-steps">
                        {mine.length === 0 ? (
                          <p className="muted" data-testid="workflow-no-steps">{t('admin.workflowTemplates.noSteps')}</p>
                        ) : (
                          <ol className="workflow-step-list">
                            {mine.map((s, i) => (
                              <li key={s.id} className={s.isActive ? '' : 'is-inactive'} data-testid={`workflow-step-${s.id}`}>
                                <span className="workflow-step-order">
                                  <IconButton icon="arrow-up" label={t('deliverables.moveUp')}
                                    disabled={resequence.isPending || i === 0}
                                    onClick={() => move(w.id, s.id, -1)}
                                    data-testid={`workflow-step-up-${s.id}`}
                                   />
                                  <IconButton icon="arrow-down" label={t('deliverables.moveDown')}
                                    disabled={resequence.isPending || i === mine.length - 1}
                                    onClick={() => move(w.id, s.id, 1)}
                                    data-testid={`workflow-step-down-${s.id}`}
                                   />
                                </span>

                                {editingStep?.id === s.id ? (
                                  <span className="workflow-step-edit">
                                    <input
                                      value={editingStep.titleEn}
                                      onChange={(e) => setEditingStep({ ...editingStep, titleEn: e.target.value })}
                                      aria-label={t('admin.workflowTemplates.titleEn')}
                                      data-testid="workflow-step-edit-en"
                                    />
                                    <input
                                      dir="rtl"
                                      value={editingStep.titleAr ?? ''}
                                      onChange={(e) => setEditingStep({ ...editingStep, titleAr: e.target.value })}
                                      aria-label={t('admin.workflowTemplates.titleAr')}
                                      data-testid="workflow-step-edit-ar"
                                    />
                                    <input
                                      type="number" min="0.5" step="0.5"
                                      value={editingStep.defaultHours ?? ''}
                                      onChange={(e) =>
                                        setEditingStep({ ...editingStep, defaultHours: e.target.value ? Number(e.target.value) : null })
                                      }
                                      aria-label={t('admin.workflowTemplates.hours')}
                                      data-testid="workflow-step-edit-hours"
                                    />
                                    {/* ADR-0059 d.2. Changing this changes the NEXT deliverable
                                        made from this template and nothing already live — a task
                                        keeps the mode it was created with, because how somebody
                                        submits their work is not something an admin edit may
                                        change under them. */}
                                    <select
                                      value={editingStep.reviewMode}
                                      onChange={(e) => setEditingStep({ ...editingStep, reviewMode: e.target.value as ReviewMode })}
                                      aria-label={t('reviewMode.column')}
                                      data-testid="workflow-step-edit-review-mode"
                                    >
                                      {REVIEW_MODES.map((m) => (
                                        <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
                                      ))}
                                    </select>
                                    <Button variant="primary"
                                      busy={saveStep.isPending}
                                      onClick={() =>
                                        saveStep.mutate(
                                          {
                                            id: editingStep.id,
                                            titleEn: editingStep.titleEn,
                                            titleAr: editingStep.titleAr,
                                            defaultHours: editingStep.defaultHours,
                                            reviewMode: editingStep.reviewMode,
                                          },
                                          {
                                            onSuccess: () => { setEditingStep(null); setError(null) },
                                            onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')),
                                          },
                                        )
                                      }
                                      data-testid="workflow-step-save"
                                    >
                                      {t('common.save')}
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={() => setEditingStep(null)} data-testid="workflow-step-cancel">
                                      {t('common.cancel')}
                                    </Button>
                                  </span>
                                ) : (
                                  <span className="workflow-step-main">
                                    <span className="workflow-step-title">{s.titleEn}</span>
                                    {s.titleAr && <span className="muted" dir="rtl"> · {s.titleAr}</span>}
                                    {/* ADR-0052 d.4: an estimate offered at assignment, never
                                        written into sla_hours — which is why it says "estimate". */}
                                    {s.defaultHours != null && (
                                      <span className="muted"> · {t('admin.workflowTemplates.hoursValue', { n: s.defaultHours })}</span>
                                    )}
                                    {/* Only `manual` is marked. Digital is what a step has always
                                        been, and labelling the 65 of 97 that never changed would
                                        bury the 32 that did. */}
                                    {s.reviewMode === 'manual' && (
                                      <span className="muted" data-testid={`workflow-step-mode-${s.id}`}> · {t('reviewMode.manual')}</span>
                                    )}
                                    {!s.isActive && <span className="muted"> · {t('admin.deliverableTypes.inactive')}</span>}
                                    <IconButton icon="edit" label={t('admin.deliverableTypes.rename')} onClick={() => setEditingStep(s)} data-testid={`workflow-step-edit-${s.id}`} />
                                    <Button
                                      variant="secondary" size="sm"
                                      onClick={() =>
                                        saveStep.mutate(
                                          { id: s.id, isActive: !s.isActive },
                                          { onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')) },
                                        )
                                      }
                                      data-testid={`workflow-step-toggle-${s.id}`}
                                    >
                                      {s.isActive ? t('admin.deliverableTypes.deactivate') : t('admin.deliverableTypes.reactivate')}
                                    </Button>
                                    {/* A template is a PLAN, not a record — nothing happened to it,
                                        so a step you do not want is removed rather than left
                                        switched off in the middle of a list somebody is reading.
                                        Tasks already made from it keep everything and lose only the
                                        link (`on delete set null`). */}
                                    <IconButton
                                      icon="trash"
                                      danger
                                      size="sm"
                                      label={t('deliverables.remove')}
                                      disabled={deleteStep.isPending}
                                      onClick={() => {
                                        if (!window.confirm(t('admin.workflowTemplates.removeStepConfirm', { name: s.titleEn }))) return
                                        deleteStep.mutate(s.id, {
                                          onError: (err) => fail(err, t('admin.workflowTemplates.saveFailed')),
                                        })
                                      }}
                                      data-testid={`workflow-step-remove-${s.id}`}
                                    />
                                  </span>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}

                        <div className="org-add-form" data-testid="workflow-step-add">
                          <input
                            value={newStep.titleEn}
                            onChange={(e) => setNewStep({ ...newStep, titleEn: e.target.value })}
                            placeholder={t('admin.workflowTemplates.titleEn')}
                            data-testid="workflow-step-new-en"
                          />
                          <input
                            dir="rtl"
                            value={newStep.titleAr}
                            onChange={(e) => setNewStep({ ...newStep, titleAr: e.target.value })}
                            placeholder={t('admin.workflowTemplates.titleAr')}
                            data-testid="workflow-step-new-ar"
                          />
                          <input
                            type="number" min="0.5" step="0.5"
                            value={newStep.hours}
                            onChange={(e) => setNewStep({ ...newStep, hours: e.target.value })}
                            placeholder={t('admin.workflowTemplates.hours')}
                            data-testid="workflow-step-new-hours"
                          />
                          <select
                            value={newStep.reviewMode}
                            onChange={(e) => setNewStep({ ...newStep, reviewMode: e.target.value as ReviewMode })}
                            aria-label={t('reviewMode.column')}
                            data-testid="workflow-step-new-review-mode"
                          >
                            {REVIEW_MODES.map((m) => (
                              <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
                            ))}
                          </select>
                          <Button variant="primary"
                            busy={createStep.isPending}
                            disabled={!newStep.titleEn.trim()}
                            onClick={() => onAddStep(w.id)}
                            data-testid="workflow-step-new-submit"
                          >
                            + {t('admin.workflowTemplates.addStep')}
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      )}

      {/* --- add a template ------------------------------------------------------ */}
      <h2 className="org-section-heading">{t('admin.workflowTemplates.addHeading')}</h2>
      <form className="org-add-form" onSubmit={onAddTemplate} data-testid="workflow-add-form">
        <input
          value={newTemplate.code}
          onChange={(e) => setNewTemplate({ ...newTemplate, code: e.target.value })}
          placeholder={t('admin.workflowTemplates.code')}
          data-testid="workflow-new-code"
        />
        <input
          value={newTemplate.nameEn}
          onChange={(e) => setNewTemplate({ ...newTemplate, nameEn: e.target.value })}
          placeholder={t('admin.workflowTemplates.nameEn')}
          data-testid="workflow-new-name-en"
        />
        <input
          dir="rtl"
          value={newTemplate.nameAr}
          onChange={(e) => setNewTemplate({ ...newTemplate, nameAr: e.target.value })}
          placeholder={t('admin.workflowTemplates.nameAr')}
          data-testid="workflow-new-name-ar"
        />
        <Button variant="primary"
          busy={createTemplate.isPending}
          type="submit"
          disabled={!newTemplate.code.trim() || !newTemplate.nameEn.trim()}
          data-testid="workflow-new-submit"
        >
          + {t('admin.workflowTemplates.addTemplate')}
        </Button>
      </form>
    </section>
  )
}
