import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import { NoticeDialog } from '../../components/Notice'
import {
  useKpiDefinitions,
  useKpiRollup,
  useKpiScorecards,
  useMyKpis,
  useSaveKpiDefinition,
  useSaveKpiTarget,
  useTenantUsers,
} from './api/kpi-api'
import { Button } from '../../components/Button'
import { DateField } from '../../components/DateField'
import { formatCalendarDay } from '../../lib/time/iraq'

/**
 * KPIs (ADR-0029, I7.4) — visibility per the confirmed rules:
 *   • everyone sees their own scorecard (own targets — RLS self);
 *   • Team Leaders see their team, Department Leads their whole department (they hold kpi:manage);
 *   • C-level / Power Admin (health:view) see company-wide and drill down to individuals.
 * The individual drill-down + team/department rollup show for kpi:manage OR health:view (oversight);
 * definition + manual-target management stays kpi:manage only (execs are read/oversight — ADR-0018).
 * Measurement + visibility only; no pay/ranking linkage (that stays P2).
 */
type Banner = { kind: 'ok' | 'error'; text: string }

function monthDefaults(): { start: string; end: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  return { start, end }
}

export function KpisPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const { session } = useAuth()
  const canManage = can('kpi:manage')
  const canOversee = canManage || can('health:view')
  const myId = session?.user.id ?? null

  const mine = useMyKpis(myId)
  const list = mine.data ?? []

  return (
    <section data-testid="surface-kpis">
      <header className="page-head">
        <h1>{t('kpi.title')}</h1>
        <p className="muted">{t('kpi.intro')}</p>
      </header>

      <h2 className="org-section-heading">{t('kpi.myScorecard')}</h2>
      {mine.isLoading ? (
        <p className="muted" data-testid="kpi-loading">…</p>
      ) : list.length === 0 ? (
        <div className="empty-state" data-testid="kpi-empty"><p>{t('kpi.noneMine')}</p></div>
      ) : (
        <table className="data-table" data-testid="kpi-my-table">
          <thead>
            <tr>
              <th>{t('kpi.colKpi')}</th>
              <th>{t('kpi.colPeriod')}</th>
              <th>{t('kpi.colTarget')}</th>
              <th>{t('kpi.colActual')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((k) => {
              const onTrack = k.target == null || k.actual == null
                ? null
                : k.higherIsBetter ? k.actual >= k.target : k.actual <= k.target
              return (
                <tr key={k.id} data-testid={`kpi-my-row-${k.id}`}>
                  <td>{k.name}{k.unit ? ` (${k.unit})` : ''}</td>
                  <td className="muted">{formatCalendarDay(k.periodStart)} → {formatCalendarDay(k.periodEnd)}</td>
                  <td>{k.target ?? '—'}</td>
                  <td className={onTrack == null ? '' : onTrack ? 'kpi-ok' : 'kpi-off'}>{k.actual ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {canOversee && <Oversight />}
      {canManage && <ManageKpis />}
    </section>
  )
}

/**
 * Oversight (kpi:manage OR health:view): the individual drill-down (RLS scopes the rows to the
 * caller's team / department / company) and the team→department rollup. Read-only.
 */
function Oversight() {
  const { t } = useTranslation()
  const period = monthDefaults()
  const defs = useKpiDefinitions()
  const users = useTenantUsers()
  const scorecards = useKpiScorecards(true)
  const userName = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id.slice(0, 8)

  const [rStart, setRStart] = useState(period.start)
  const [rEnd, setREnd] = useState(period.end)
  const [rOn, setROn] = useState(false)
  const rollup = useKpiRollup(rStart, rEnd, rOn)
  const defName = (id: string) => defs.data?.find((d) => d.id === id)?.name ?? id.slice(0, 8)

  const rows = scorecards.data ?? []
  const flex = { display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem', alignItems: 'center' }

  return (
    <div data-testid="kpi-oversight">
      <h2 className="org-section-heading">{t('kpi.individuals')}</h2>
      {scorecards.isLoading ? (
        <p className="muted">…</p>
      ) : rows.length === 0 ? (
        <p className="muted" data-testid="kpi-individuals-empty">{t('kpi.individualsEmpty')}</p>
      ) : (
        <table className="data-table" data-testid="kpi-individuals-table">
          <thead>
            <tr>
              <th>{t('kpi.colPerson')}</th>
              <th>{t('kpi.colKpi')}</th>
              <th>{t('kpi.colPeriod')}</th>
              <th>{t('kpi.colTarget')}</th>
              <th>{t('kpi.colActual')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const onTrack = r.target == null || r.actual == null
                ? null
                : r.higherIsBetter ? r.actual >= r.target : r.actual <= r.target
              return (
                <tr key={r.id} data-testid={`kpi-individual-row-${r.id}`}>
                  <td>{userName(r.userId)}</td>
                  <td>{r.name}{r.unit ? ` (${r.unit})` : ''}</td>
                  <td className="muted">{formatCalendarDay(r.periodStart)} → {formatCalendarDay(r.periodEnd)}</td>
                  <td>{r.target ?? '—'}</td>
                  <td className={onTrack == null ? '' : onTrack ? 'kpi-ok' : 'kpi-off'}>{r.actual ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h2 className="org-section-heading">{t('kpi.rollup')}</h2>
      <div className="org-add-form" style={flex}>
        <DateField value={rStart} onChange={(v) => { setRStart(v); setROn(false) }} data-testid="kpi-rollup-start" aria-label={t('kpi.periodStart')} />
        <DateField value={rEnd} onChange={(v) => { setREnd(v); setROn(false) }} data-testid="kpi-rollup-end" aria-label={t('kpi.periodEnd')} />
        <Button variant="secondary" onClick={() => setROn(true)} data-testid="kpi-rollup-load">{t('kpi.loadRollup')}</Button>
      </div>
      {rOn && (rollup.data ?? []).length > 0 && (
        <table className="data-table" data-testid="kpi-rollup-table">
          <thead><tr><th>{t('kpi.colKpi')}</th><th>{t('kpi.colScope')}</th><th>{t('kpi.colTarget')}</th><th>{t('kpi.colActual')}</th></tr></thead>
          <tbody>
            {(rollup.data ?? []).map((r, i) => (
              <tr key={`${r.kpiDefinitionId}-${r.scopeKind}-${r.scopeId}-${i}`}>
                <td>{defName(r.kpiDefinitionId)}</td>
                <td>{t(`kpi.scope.${r.scopeKind}`)}</td>
                <td>{r.target ?? '—'}</td>
                <td>{r.actual ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rOn && (rollup.data ?? []).length === 0 && <p className="muted" data-testid="kpi-rollup-empty">{t('kpi.rollupEmpty')}</p>}
    </div>
  )
}

/**
 * Management (kpi:manage only): create KPI definitions and set per-person manual targets/actuals.
 * Manual targets are kept alongside SLA-profile / at-assignment targets (Edward's confirmed model).
 */
function ManageKpis() {
  const { t } = useTranslation()
  const defs = useKpiDefinitions()
  const users = useTenantUsers()
  const saveDef = useSaveKpiDefinition()
  const saveTarget = useSaveKpiTarget()
  const [banner, setBanner] = useState<Banner | null>(null)

  // new definition
  const [dName, setDName] = useState('')
  const [dUnit, setDUnit] = useState('')
  const [dAgg, setDAgg] = useState<'avg' | 'sum' | 'weighted'>('avg')
  const [dHib, setDHib] = useState(true)

  // set target
  const period = monthDefaults()
  const [tDef, setTDef] = useState('')
  const [tUser, setTUser] = useState('')
  const [tStart, setTStart] = useState(period.start)
  const [tEnd, setTEnd] = useState(period.end)
  const [tTarget, setTTarget] = useState('')
  const [tActual, setTActual] = useState('')

  function addDef(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!dName.trim()) return
    setBanner(null)
    saveDef.mutate(
      { name: dName, unit: dUnit || null, aggregation: dAgg, higherIsBetter: dHib },
      {
        onSuccess: () => { setBanner({ kind: 'ok', text: t('kpi.defSaved') }); setDName(''); setDUnit('') },
        onError: (err) => setBanner({ kind: 'error', text: (err as { message?: string })?.message || t('kpi.saveFailed') }),
      },
    )
  }

  function setTargetSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!tDef || !tUser) { setBanner({ kind: 'error', text: t('kpi.targetNeedsBoth') }); return }
    setBanner(null)
    saveTarget.mutate(
      {
        kpiDefinitionId: tDef, userId: tUser, periodStart: tStart, periodEnd: tEnd,
        target: tTarget ? Number(tTarget) : null, actual: tActual ? Number(tActual) : null,
      },
      {
        onSuccess: () => { setBanner({ kind: 'ok', text: t('kpi.targetSaved') }); setTTarget(''); setTActual('') },
        onError: (err) => setBanner({ kind: 'error', text: (err as { message?: string })?.message || t('kpi.saveFailed') }),
      },
    )
  }

  const flex = { display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem', alignItems: 'center' }

  return (
    <div data-testid="kpi-manage">
      {/* Edward, 29 Aug: an action reports what it did in front of the person, not as
          a strip above the page. Same rule `I12.9` set for the schedule refusal. */}
      {banner && (
        <NoticeDialog
          kind={banner.kind === 'error' ? 'error' : 'success'}
          message={banner.text}
          testId="kpi-banner"
          onClose={() => setBanner(null)}
        />
      )}

      <h2 className="org-section-heading">{t('kpi.definitions')}</h2>
      {(defs.data ?? []).length > 0 && (
        <table className="data-table" data-testid="kpi-defs-table">
          <thead><tr><th>{t('kpi.colKpi')}</th><th>{t('kpi.colUnit')}</th><th>{t('kpi.colAggregation')}</th><th>{t('kpi.colDirection')}</th></tr></thead>
          <tbody>
            {(defs.data ?? []).map((d) => (
              <tr key={d.id} data-testid={`kpi-def-row-${d.id}`}>
                <td>{d.name}</td><td>{d.unit ?? '—'}</td><td>{t(`kpi.agg.${d.aggregation}`)}</td>
                <td>{d.higherIsBetter ? t('kpi.higherBetter') : t('kpi.lowerBetter')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="org-add-form" style={flex} onSubmit={addDef} data-testid="kpi-def-form">
        <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder={t('kpi.colKpi')} data-testid="kpi-def-name" />
        <input value={dUnit} onChange={(e) => setDUnit(e.target.value)} placeholder={t('kpi.unitPlaceholder')} data-testid="kpi-def-unit" />
        <select value={dAgg} onChange={(e) => setDAgg(e.target.value as 'avg' | 'sum' | 'weighted')} data-testid="kpi-def-agg">
          <option value="avg">{t('kpi.agg.avg')}</option>
          <option value="sum">{t('kpi.agg.sum')}</option>
          <option value="weighted">{t('kpi.agg.weighted')}</option>
        </select>
        <label className="check"><input type="checkbox" checked={dHib} onChange={(e) => setDHib(e.target.checked)} data-testid="kpi-def-hib" /> {t('kpi.higherBetter')}</label>
        <Button variant="primary" type="submit" disabled={saveDef.isPending} data-testid="kpi-def-submit">{t('kpi.addDefinition')}</Button>
      </form>

      <h2 className="org-section-heading">{t('kpi.setTarget')}</h2>
      <form className="org-add-form" style={flex} onSubmit={setTargetSubmit} data-testid="kpi-target-form">
        <select value={tDef} onChange={(e) => setTDef(e.target.value)} data-testid="kpi-target-def">
          <option value="">{t('kpi.pickKpi')}</option>
          {(defs.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={tUser} onChange={(e) => setTUser(e.target.value)} data-testid="kpi-target-user">
          <option value="">{t('kpi.pickPerson')}</option>
          {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <DateField value={tStart} onChange={(v) => setTStart(v)} data-testid="kpi-target-start" aria-label={t('kpi.periodStart')} />
        <DateField value={tEnd} onChange={(v) => setTEnd(v)} data-testid="kpi-target-end" aria-label={t('kpi.periodEnd')} />
        <input type="number" step="0.1" value={tTarget} onChange={(e) => setTTarget(e.target.value)} placeholder={t('kpi.colTarget')} data-testid="kpi-target-target" className="num-input" />
        <input type="number" step="0.1" value={tActual} onChange={(e) => setTActual(e.target.value)} placeholder={t('kpi.colActual')} data-testid="kpi-target-actual" className="num-input" />
        <Button variant="primary" type="submit" disabled={saveTarget.isPending} data-testid="kpi-target-submit">{t('kpi.saveTarget')}</Button>
      </form>
    </div>
  )
}
