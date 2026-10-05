import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { LanguagePicker, type LanguageOption } from '../../../components/LanguagePicker'
import { Field } from '../../../components/Field'
import { NoticeBox } from '../../../components/NoticeBox'
import { DeliverablePicker } from '../../../components/DeliverablePicker'
import { PillSelect } from '../../../components/PillSelect'
import { capacityLevel, useTeamLoad } from '../../team/api/team-api'
import type { DepartmentLead } from '../api/intake-api'
import { EMPTY_SPEC, PRIORITIES, readsLikeACampaign, type DeliverableSpec, type Priority, type RequestDraft } from '../lib/single-job'
import { dayStrip, formatDayLong, type LeadTime } from '../lib/lead-time'
import type { WorkingCalendar } from '../../../lib/campaigns/go-live-dates'
import { ResponseClock } from './ResponseClock'
import { DateField } from '../../../components/DateField'

/**
 * SJ-v3-04 — Who and when (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep), on ADR-0083.
 *
 * Left, **Which team**: the department as pills — never a person (d.8/d.9); the lead named in a
 * tinted row with the team's load for the due week (d.10); a department with no lead offers its
 * team leads as the owner (d.12), one with nobody senior says so and still goes through. Right,
 * **When**: the due date, and "Maestro counted it back for you" — the working days the deliverable
 * type needs (`lead_time_hours`), counted back from the due date over the Iraq week, Sunday to
 * Thursday; then the priority. Below, **What is being made**: the title, the deliverable type,
 * quantity, channel and format — not drawn on the Figma's frame, needed by its review card
 * ("1 DELIVERABLE · CAROUSEL · INSTAGRAM", Quantity, Format) and by the job's name.
 *
 * "If Fadia has not assigned it within 24 hours it escalates to the traffic manager on its own"
 * — ADR-0045's ladder, built 22 Sep: `stall-sweep` → `app.escalate_unassigned_jobs`, the hours
 * the tenant's (`assignment_escalation_hours`, default 24), to the `scheduler` role (Traffic) and
 * the owner. The line names the lead and the hours.
 *
 * Presentation only. Every list arrives as a prop; the one hook is the team load for the due week.
 */
export interface WhoAndWhenStepProps {
  value: RequestDraft
  onChange: (next: RequestDraft) => void
  clockStart: string | null
  types: { id: string; nameEn: string; nameAr?: string | null; categoryCode: string; code: string; categoryName?: string; categoryNameAr?: string | null; categoryOrder?: number; leadTimeHours?: number | null }[]
  channels: { code: string; labelEn: string }[]
  formats: { code: string; labelEn: string }[]
  departments: { id: string; name: string }[]
  leads: DepartmentLead[]
  teamLeads: DepartmentLead[]
  ownerPick: string
  onOwnerPick: (id: string) => void
  /** ADR-0117: the tenant's languages, and adding one it lacks. */
  languageOptions: readonly LanguageOption[]
  onAddLanguage: (label: string) => Promise<string>
  addingLanguage?: boolean
  /** What the chosen type needs, counted back from the due date. */
  leadTime: LeadTime | null
  /** The client's working week (ADR-0123 d.3) — the strip's weekend days. Iraq's when absent. */
  calendar?: WorkingCalendar
  /** The tenant's hours before an unassigned job escalates to traffic (ADR-0045 d.3). */
  escalationHours: number
  missing: readonly (keyof RequestDraft)[]
  /** ADR-0138 d.1: where the brief's suggestion stands — always said, never a silent blank. */
  suggestion?: 'asking' | 'suggested' | 'none' | 'failed' | null
}

export function WhoAndWhenStep({
  value,
  onChange,
  clockStart,
  types,
  channels,
  formats,
  departments,
  leads,
  teamLeads,
  ownerPick,
  onOwnerPick,
  languageOptions,
  onAddLanguage,
  addingLanguage = false,
  leadTime,
  calendar,
  escalationHours,
  missing,
  suggestion = null,
}: WhoAndWhenStepProps) {
  const { t, i18n } = useTranslation()
  const ar = i18n.language === 'ar'
  const locale = ar ? 'ar' : 'en'
  const set = <K extends keyof RequestDraft>(key: K, v: RequestDraft[K]) => onChange({ ...value, [key]: v })
  const isMissing = (k: keyof RequestDraft) => missing.includes(k)

  const typeOptions = useMemo(
    () => types.map((x) => ({
      id: x.id, code: x.code,
      name: (ar && x.nameAr) || x.nameEn,
      nameAlt: ar ? x.nameEn : x.nameAr ?? null,
      category: (ar && x.categoryNameAr) || x.categoryName || x.categoryCode,
      categoryOrder: x.categoryOrder ?? 0,
    })),
    [types, ar],
  )
  const typeName = types.find((x) => x.id === value.deliverableTypeId)
  const typeLabel = typeName ? ((ar && typeName.nameAr) || typeName.nameEn) : null

  const departmentLeads = leads.filter((l) => l.departmentId === value.departmentId)
  const lead = departmentLeads[0] ?? null
  const departmentTeamLeads = teamLeads.filter((l) => l.departmentId === value.departmentId)
  // Edward, 27 Sep (ADR-0083 addendum): the owner is CHOSEN from the department's lead and every
  // one of its team leads. The department lead is chosen until somebody picks another; with no
  // department lead, a team lead must be picked (d.12).
  const owner =
    [...departmentLeads, ...departmentTeamLeads].find((l) => l.id === ownerPick) ?? lead
  const ownerIsDepartmentLead = owner != null && departmentLeads.some((l) => l.id === owner.id)
  const departmentName = departments.find((d) => d.id === value.departmentId)?.name ?? ''
  const strip = leadTime && value.dueDate ? dayStrip(value.dueDate, leadTime.needsDays, locale, calendar) : null

  return (
    <div className="sj-step" data-testid="sj-request">
      <div className="sj-head">
        <div>
          <h1 className="sj-head-title">{t('intake.who.title')}</h1>
          <p className="sj-head-sub">{t('intake.who.intro')}</p>
        </div>
        <ResponseClock variant="chip" startIso={clockStart} testId="sj-clock" />
      </div>

      <div className="sj-who-grid">
        {/* Which team */}
        <section className="sj-card" data-testid="sj-panel-job">
          <h2 className="sj-card-title">{t('intake.who.whichTeam')}</h2>
          <PillSelect
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            value={value.departmentId}
            onChange={(id) => { set('departmentId', id); onOwnerPick('') }}
            ariaLabel={t('intake.request.department')}
            invalid={isMissing('departmentId')}
            testId="sj-department"
          />
          {value.departmentId && (
            departmentLeads.length + departmentTeamLeads.length > 0 ? (
              <>
                {owner && (
                  <LeadRow
                    lead={owner}
                    role={ownerIsDepartmentLead
                      ? t('intake.who.departmentLead')
                      : t('intake.who.teamLead')}
                    departmentId={value.departmentId}
                    departmentName={departmentName}
                    dueDate={value.dueDate}
                  />
                )}
                <Field
                  label={t('intake.request.owner')}
                  required
                  hint={lead ? undefined : t('intake.request.noLeadPickTeamLead', { department: departmentName })}
                >
                  <select
                    value={owner?.id ?? ''}
                    onChange={(e) => onOwnerPick(e.target.value)}
                    aria-invalid={(!lead && !owner) || undefined}
                    data-testid="sj-owner-select"
                  >
                    {!lead && <option value="">{t('intake.who.chooseTeamLead')}</option>}
                    {departmentLeads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {t('intake.who.ownerOption', { name: l.name, role: t('intake.who.departmentLead') })}
                      </option>
                    ))}
                    {departmentTeamLeads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {t('intake.who.ownerOption', { name: l.name, role: t('intake.who.teamLead') })}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <NoticeBox testId="sj-owner-none" lines={[t('intake.request.noLead', { department: departmentName })]} />
            )
          )}
          <p className="sj-card-note" data-testid="sj-escalation-note">
            {owner
              ? t('intake.who.neverAPersonNamed', { lead: owner.name, hours: escalationHours })
              : t('intake.who.neverAPerson', { hours: escalationHours })}
          </p>
        </section>

        {/* When */}
        <section className="sj-card" data-testid="sj-panel-when">
          <h2 className="sj-card-title">{t('intake.who.when')}</h2>
          <Field label={t('intake.request.due')} required>
            <DateField value={value.dueDate} onChange={(v) => set('dueDate', v)} aria-invalid={isMissing('dueDate') || undefined} className="sj-due-input" data-testid="sj-due" />
          </Field>
          {strip && leadTime && (
            <div className="sj-countback" data-testid="sj-countback">
              <span className="sj-countback-title">{t('intake.who.countedBack')}</span>
              <div className="sj-countback-days">
                {strip.map((d) => (
                  <span key={d.iso} className={`sj-day is-${d.kind}`} data-testid={`sj-day-${d.iso}`}>
                    <span className="sj-day-name">{d.label}</span>
                    <span className="sj-day-role">{d.kind === 'start' ? t('intake.who.starts') : d.kind === 'due' ? t('intake.who.due') : d.kind === 'weekend' ? t('intake.who.weekend') : '·'}</span>
                  </span>
                ))}
              </div>
              <p className="sj-countback-note" data-testid="sj-countback-note">
                {typeLabel
                  ? t('intake.who.needsDays', { type: typeLabel, n: leadTime.needsDays })
                  : t('intake.who.needsDaysUntyped', { n: leadTime.needsDays })}{' '}
                {t('intake.who.weekNote')}
                {leadTime.hasDays < leadTime.needsDays && value.dueDate && (
                  <span className="sj-countback-short" data-testid="sj-countback-short"> {t('intake.who.short', { has: leadTime.hasDays, day: formatDayLong(value.dueDate, locale) })}</span>
                )}
              </p>
            </div>
          )}
          <Field label={t('intake.who.priority')} as="div">
            <PillSelect<Priority>
              options={PRIORITIES.map((p) => ({ value: p, label: t(`intake.who.priorities.${p}`) }))}
              value={value.priority}
              onChange={(p) => set('priority', p)}
              ariaLabel={t('intake.who.priority')}
              testId="sj-priority"
            />
          </Field>
        </section>

        {/* What is being made — the title and the deliverable, for the review card and the job's name */}
        <section className="sj-card sj-card-wide" data-testid="sj-panel-what">
          <h2 className="sj-card-title">{t('intake.who.whatIsMade')}</h2>
          {suggestion && (
            <p className={`sj-suggestion sj-suggestion-${suggestion}`} role="status" data-testid="sj-suggestion">
              {t(`intake.who.suggestion.${suggestion}`)}
            </p>
          )}
          <div className="sj-what-grid">
            <Field label={t('intake.request.title')} required hint={t('intake.request.titleHint')}>
              <input value={value.title} onChange={(e) => set('title', e.target.value)} aria-invalid={isMissing('title') || undefined} data-testid="sj-title" />
            </Field>
            <Field label={t('intake.request.type')} as="div">
              <DeliverablePicker
                items={typeOptions}
                value={value.deliverableTypeId}
                onChange={(id) => set('deliverableTypeId', id)}
                placeholder={t('intake.request.typeHint')}
                testId="sj-type"
              />
              {/* Warn-and-allow (§4.1): untyped is legal (ADR-0051 d.7), and the cost is said. */}
              {!value.deliverableTypeId && (
                <span className="field-hint" data-testid="sj-type-none">{t('intake.request.typeNone')}</span>
              )}
            </Field>
            <Field label={t('intake.request.quantity')}>
              <input type="number" min={1} value={value.quantity} onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} data-testid="sj-quantity" />
            </Field>
            <Field label={t('campaigns.wizard.colChannel')}>
              <select value={value.channel} onChange={(e) => set('channel', e.target.value)} data-testid="sj-channel">
                <option value="">{t('campaigns.wizard.noneChosen')}</option>
                {channels.map((v) => <option key={v.code} value={v.code}>{v.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('campaigns.wizard.colFormat')}>
              <select value={value.format} onChange={(e) => set('format', e.target.value)} data-testid="sj-format">
                <option value="">{t('campaigns.wizard.noneChosen')}</option>
                {formats.map((v) => <option key={v.code} value={v.code}>{v.labelEn}</option>)}
              </select>
            </Field>
          </div>

          {/* I54.33 (Edward, 27 Sep): further deliverables — the same department, owner and due date as
              the job; only what each one is, how many, its channel and format. */}
          {value.more.map((m, i) => {
            // A person's change makes the row theirs: the "suggested" mark goes (ADR-0138 d.1).
            const setMore = (patch: Partial<DeliverableSpec>) =>
              set('more', value.more.map((x, j) => (j === i ? { ...x, ...patch, suggested: false } : x)))
            const rowDept = m.departmentId || value.departmentId
            const rowOwners = [...leads, ...teamLeads].filter((l, k, all) => l.departmentId === rowDept && all.findIndex((x) => x.id === l.id) === k)
            return (
              <div className="sj-more-row" key={i} data-testid={`sj-more-${i}`}>
                {m.suggested && <span className="sj-suggested-chip" data-testid={`sj-more-suggested-${i}`}>{t('intake.who.suggested')}</span>}
                <Field label={t('intake.request.type')} as="div">
                  <DeliverablePicker
                    items={typeOptions}
                    value={m.deliverableTypeId}
                    onChange={(id) => setMore({ deliverableTypeId: id })}
                    placeholder={t('intake.request.typeHint')}
                    testId={`sj-more-type-${i}`}
                  />
                </Field>
                <Field label={t('intake.request.quantity')}>
                  <input type="number" min={1} value={m.quantity} onChange={(e) => setMore({ quantity: Math.max(1, Number(e.target.value) || 1) })} data-testid={`sj-more-quantity-${i}`} />
                </Field>
                <Field label={t('campaigns.wizard.colChannel')}>
                  <select value={m.channel} onChange={(e) => setMore({ channel: e.target.value })} data-testid={`sj-more-channel-${i}`}>
                    <option value="">{t('campaigns.wizard.noneChosen')}</option>
                    {channels.map((v) => <option key={v.code} value={v.code}>{v.labelEn}</option>)}
                  </select>
                </Field>
                <Field label={t('campaigns.wizard.colFormat')}>
                  <select value={m.format} onChange={(e) => setMore({ format: e.target.value })} data-testid={`sj-more-format-${i}`}>
                    <option value="">{t('campaigns.wizard.noneChosen')}</option>
                    {formats.map((v) => <option key={v.code} value={v.code}>{v.labelEn}</option>)}
                  </select>
                </Field>
                {/* ADR-0138 d.2–3: its own department and owner (a lead there), its own day — the job's by default. */}
                <Field label={t('intake.who.pieceDepartment')}>
                  <select
                    value={m.departmentId}
                    onChange={(e) => {
                      const dept = e.target.value
                      setMore({ departmentId: dept, ownerUserId: dept ? leads.find((l) => l.departmentId === dept)?.id ?? '' : '' })
                    }}
                    data-testid={`sj-more-department-${i}`}
                  >
                    <option value="">{t('intake.who.sameAsJob')}</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                {m.departmentId && (
                  <Field label={t('intake.who.pieceOwner')}>
                    <select value={m.ownerUserId} onChange={(e) => setMore({ ownerUserId: e.target.value })} data-testid={`sj-more-owner-${i}`}>
                      {rowOwners.length === 0 && <option value="">{t('intake.who.noLeadThere')}</option>}
                      {rowOwners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field label={t('intake.who.pieceDue')} as="div">
                  <DateField value={m.dueDate || value.dueDate} onChange={(v) => setMore({ dueDate: v === value.dueDate ? '' : v })} data-testid={`sj-more-due-${i}`} />
                </Field>
                <IconButton
                  icon="trash"
                  label={t('intake.who.removeDeliverable')}
                  className="sj-more-remove"
                  onClick={() => set('more', value.more.filter((_, j) => j !== i))}
                  data-testid={`sj-more-remove-${i}`}
                />
              </div>
            )
          })}
          {(() => {
            // ADR-0138 d.4: warned, never refused.
            const w = readsLikeACampaign(value)
            return (w.departments || w.dates) ? (
              <NoticeBox
                kind="warn"
                testId="sj-reads-like-campaign"
                lines={[t('intake.who.campaignWarning'), w.departments && t('intake.who.campaignWarningDepartments'), w.dates && t('intake.who.campaignWarningDates')]}
              />
            ) : null
          })()}
          {/* ADR-0117 d.1 (Edward, 27 Sep): the languages the job is made in, beside what is made.
              Every deliverable's task list gets one translation task naming them. */}
          {/* ADR-0117 addendum (Q19, 4 Oct): at least one — no default, the person picks. */}
          <Field label={t('languages.title')} as="div" required hint={t('languages.hint')}
            error={isMissing('languages') ? <span data-testid="sj-languages-missing">{t('languages.requiredJob')}</span> : undefined}>
            <LanguagePicker
              options={languageOptions}
              value={value.languages}
              onChange={(codes) => set('languages', codes)}
              onAdd={onAddLanguage}
              adding={addingLanguage}
              testId="sj-languages-picker"
            />
          </Field>
          <Button variant="link" size="sm" icon="plus" className="sj-add-deliverable" onClick={() => set('more', [...value.more, { ...EMPTY_SPEC }])} data-testid="sj-add-deliverable">
            {t('intake.who.addDeliverable')}
          </Button>
        </section>
      </div>
    </div>
  )
}

/**
 * The chosen owner — the department's lead unless another was picked — with the department's load
 * for the week the due date falls in (ADR-0083 d.10): the Figma's tinted row, avatar, "Name · role",
 * the sentence, and "TEAM AT n%".
 */
function LeadRow({
  lead,
  role,
  departmentId,
  departmentName,
  dueDate,
}: {
  lead: DepartmentLead
  role: string
  departmentId: string
  departmentName: string
  dueDate: string
}) {
  const { t } = useTranslation()
  const load = useTeamLoad(dueDate || null)
  const people = load.groups.flatMap((g) => g.people).filter((p) => p.departmentId === departmentId)
  const booked = people.reduce((n, p) => n + p.bookedHours, 0)
  const nominal = people.reduce((n, p) => n + p.nominalHours, 0)
  const utilPct = nominal > 0 ? Math.round((booked / nominal) * 100) : 0
  const level = capacityLevel(utilPct)
  const initials = lead.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  return (
    <div className="sj-lead-row" data-testid="sj-owner">
      <span className="sj-lead-avatar" aria-hidden="true">{initials}</span>
      <span className="sj-lead-text">
        <span className="sj-lead-name">
          <span data-testid="sj-owner-name">{lead.name}</span> · {role}
        </span>
        <span className="sj-lead-sub">{t('intake.who.landsInQueue')}</span>
      </span>
      {load.isLoading ? (
        <span className="muted">…</span>
      ) : load.isError ? (
        <span className="muted" data-testid="sj-owner-load-failed">{t('intake.request.loadFailed')}</span>
      ) : people.length === 0 ? (
        <span className="sj-lead-load is-none" data-testid="sj-owner-load-none">{t('intake.request.loadNone', { department: departmentName })}</span>
      ) : (
        <span className={`sj-lead-load is-${level}`} data-testid="sj-owner-load" title={t(dueDate ? 'intake.request.loadWeekDue' : 'intake.request.loadWeekThis', { department: departmentName, pct: utilPct, week: load.week.label })}>
          {t('intake.who.teamAt', { pct: utilPct })}
          <span className="sj-lead-load-week"> · {t(dueDate ? 'intake.request.loadWeekDue' : 'intake.request.loadWeekThis', { department: departmentName, pct: utilPct, week: load.week.label })}</span>
        </span>
      )}
    </div>
  )
}
