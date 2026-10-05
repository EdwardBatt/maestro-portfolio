import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, DeleteButton } from '../../../components/Button'
import { roleName } from '../../../lib/roles/role-text'
import { BUILT_IN_FILLER_WORDS } from '../../../lib/brief/filler'
import {
  normalizeFillerWord,
  useAddFillerWord,
  useFillerWords,
  useRemoveFillerWord,
} from '../../../lib/brief/filler-words-api'
import { useAssignableRoles } from '../api/admin-api'
import {
  DEFAULT_TIMINGS,
  RELATIVE_RECIPIENTS,
  changedRules,
  useEscalationRules,
  useEscalationTimings,
  useEscalationsReachingNobody,
  useSaveEscalationSettings,
  type EscalationRule,
  type EscalationTimings,
  type RelativeRecipient,
} from '../api/escalation-settings-api'

/**
 * Admin → Organization → Escalations (ADR-0108 + addendum, Q21 / Q22 / E8 / E9 / Q14 / Q37b / Q29).
 *
 * Beside the scheduling rules, with the same grant (`organization:manage`, RLS) and the same save:
 * edit, then one Save. Each stall is a row — how many real-time hours before it escalates, which
 * roles and which people on the piece are told. A row whose recipients resolve to nobody says so
 * (E9): the sweep sends it to Traffic, and this is where the gap is fixed. Under the rows, the two
 * numbers that are not rows (the over-capacity percentage, the untimed-round minutes), and the
 * tenant's own filler words, which are added and removed at once like any list on this page.
 */
export function EscalationSettingsSection({
  onSaved,
  onError,
}: {
  onSaved: (messageKey: string) => void
  onError: (err: unknown, fallbackKey: string) => void
}) {
  const { t } = useTranslation()
  const rules = useEscalationRules()
  const timings = useEscalationTimings()
  const nobody = useEscalationsReachingNobody()
  const roles = useAssignableRoles()
  const save = useSaveEscalationSettings()

  const [draft, setDraft] = useState<EscalationRule[]>([])
  const [times, setTimes] = useState<EscalationTimings>(DEFAULT_TIMINGS)
  const [touched, setTouched] = useState(false)

  // A slow read must not overwrite what somebody has started typing (traps.md).
  useEffect(() => {
    if (!touched && rules.data) setDraft(rules.data)
  }, [rules.data, touched])
  useEffect(() => {
    if (!touched && timings.data) setTimes(timings.data)
  }, [timings.data, touched])

  const roleList = roles.data ?? []
  const roleLabel = (id: string) => {
    const r = roleList.find((x) => x.id === id)
    return r ? roleName(t, r) : '—'
  }
  const kindLabel = (kind: string) => t(`escalations.kind.${kind}`, { defaultValue: kind })
  const reachesNobody = new Set(nobody.data ?? [])

  const edit = (id: string, patch: Partial<EscalationRule>) => {
    setTouched(true)
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  const positive = (v: string, fallback: number, max: number) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const changed = changedRules(rules.data ?? [], draft)
    const timingsChanged =
      !timings.data ||
      timings.data.overCapacityPct !== times.overCapacityPct ||
      timings.data.untimedThresholdMinutes !== times.untimedThresholdMinutes
    save.mutate(
      { rules: changed, timings: timingsChanged ? times : null },
      {
        onSuccess: () => {
          setTouched(false)
          onSaved('escalations.settings.saved')
        },
        onError: (err) =>
          onError(err, (err as { code?: string }).code === '42501' ? 'escalations.settings.refused' : 'escalations.settings.saveFailed'),
      },
    )
  }

  return (
    <>
      <h2 className="org-section-heading">{t('escalations.settings.heading')}</h2>
      <p className="muted">{t('escalations.settings.intro')}</p>
      {rules.isError || timings.isError ? (
        <p className="form-error" data-testid="escalation-settings-failed">{t('escalations.settings.loadFailed')}</p>
      ) : (
        <form className="org-settings-form escalation-form" onSubmit={submit} data-testid="escalation-settings-form">
          {draft.length === 0 && !rules.isLoading ? (
            <p className="muted" data-testid="escalation-rules-empty">{t('escalations.settings.empty')}</p>
          ) : (
            <table className="data-table escalation-table" data-testid="escalation-rules">
              <thead>
                <tr>
                  <th>{t('escalations.settings.kind')}</th>
                  <th>{t('escalations.settings.hours')}</th>
                  <th>{t('escalations.settings.roles')}</th>
                  <th>{t('escalations.settings.people')}</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((r) => {
                  const label = kindLabel(r.kind)
                  const unpicked = roleList.filter((x) => !r.roleIds.includes(x.id))
                  return (
                    <tr key={r.id} data-testid={`escalation-row-${r.kind}`}>
                      <td>
                        <span className="escalation-kind">{label}</span>
                        {reachesNobody.has(r.kind) && (
                          <span className="tag tag-warn escalation-nobody" data-testid={`escalation-nobody-${r.kind}`}>
                            {t('escalations.settings.reachesNobody')}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="escalation-hours">
                          <input
                            type="number"
                            min={1}
                            max={8760}
                            value={r.hours}
                            aria-label={t('escalations.settings.hoursLabel', { kind: label })}
                            onChange={(e) => edit(r.id, { hours: positive(e.target.value, r.hours, 8760) })}
                            data-testid={`escalation-hours-${r.kind}`}
                          />
                          <span className="muted">{t('escalations.settings.hoursUnit')}</span>
                        </span>
                      </td>
                      <td>
                        <div className="escalation-roles">
                          {r.roleIds.length === 0 && <span className="muted">{t('escalations.settings.noRoles')}</span>}
                          {r.roleIds.map((id) => (
                            <span key={id} className="escalation-chip" data-testid={`escalation-role-${r.kind}-${id}`}>
                              {roleLabel(id)}
                              <IconButton
                                icon="close"
                                size="sm"
                                label={t('escalations.settings.removeRole', { name: roleLabel(id) })}
                                onClick={() => edit(r.id, { roleIds: r.roleIds.filter((x) => x !== id) })}
                                data-testid={`escalation-role-remove-${r.kind}-${id}`}
                              />
                            </span>
                          ))}
                          {unpicked.length > 0 && (
                            <select
                              value=""
                              aria-label={t('escalations.settings.addRoleLabel', { kind: label })}
                              onChange={(e) => {
                                const id = e.target.value
                                if (id) edit(r.id, { roleIds: [...r.roleIds, id] })
                              }}
                              data-testid={`escalation-role-add-${r.kind}`}
                            >
                              <option value="">{t('escalations.settings.addRole')}</option>
                              {unpicked.map((x) => (
                                <option key={x.id} value={x.id}>{roleName(t, x)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="escalation-people">
                          {RELATIVE_RECIPIENTS.map((p: RelativeRecipient) => (
                            <label key={p} className="escalation-person">
                              <input
                                type="checkbox"
                                checked={r.relative.includes(p)}
                                onChange={(e) =>
                                  edit(r.id, {
                                    relative: e.target.checked ? [...r.relative, p] : r.relative.filter((x) => x !== p),
                                  })
                                }
                                data-testid={`escalation-person-${r.kind}-${p}`}
                              />
                              {t(`escalations.relative.${p}`)}
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <label className="escalation-inline">
            <span>{t('escalations.settings.overCapacityBefore')}</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={times.overCapacityPct}
              onChange={(e) => {
                setTouched(true)
                setTimes((x) => ({ ...x, overCapacityPct: positive(e.target.value, x.overCapacityPct, 1000) }))
              }}
              data-testid="escalation-over-capacity"
            />
            <span>{t('escalations.settings.overCapacityAfter')}</span>
          </label>
          <label className="escalation-inline">
            <span>{t('escalations.settings.untimedBefore')}</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={times.untimedThresholdMinutes}
              onChange={(e) => {
                setTouched(true)
                setTimes((x) => ({ ...x, untimedThresholdMinutes: positive(e.target.value, x.untimedThresholdMinutes, 1440) }))
              }}
              data-testid="escalation-untimed-minutes"
            />
            <span>{t('escalations.settings.untimedAfter')}</span>
          </label>
          <div>
            <Button variant="primary" type="submit" busy={save.isPending} disabled={!touched} data-testid="escalation-settings-save">
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}

      <FillerWordsPanel onSaved={onSaved} onError={onError} />
    </>
  )
}

/** ADR-0111 d.3: the tenant's own filler words beside the built-ins, which cannot be removed. */
function FillerWordsPanel({
  onSaved,
  onError,
}: {
  onSaved: (messageKey: string) => void
  onError: (err: unknown, fallbackKey: string) => void
}) {
  const { t } = useTranslation()
  const words = useFillerWords()
  const add = useAddFillerWord()
  const remove = useRemoveFillerWord()
  const [text, setText] = useState('')
  const [armedId, setArmedId] = useState<string | null>(null)

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const word = normalizeFillerWord(text)
    if (!word) return
    add.mutate(word, {
      onSuccess: () => {
        setText('')
        onSaved('escalations.filler.added')
      },
      onError: (err) => {
        const code = (err as { code?: string }).code
        onError(err, code === '23505' ? 'escalations.filler.duplicate' : code === '42501' ? 'escalations.settings.refused' : 'escalations.filler.failed')
      },
    })
  }

  function onRemove(id: string) {
    if (armedId !== id) { setArmedId(id); return }
    setArmedId(null)
    remove.mutate(id, {
      onSuccess: () => onSaved('escalations.filler.removed'),
      onError: (err) =>
        onError(err, (err as { code?: string }).code === '42501' ? 'escalations.settings.refused' : 'escalations.filler.failed'),
    })
  }

  const own = words.data ?? []

  return (
    <div className="filler-words" data-testid="filler-words">
      <h3 className="org-section-subheading">{t('escalations.filler.heading')}</h3>
      <p className="muted">{t('escalations.filler.intro')}</p>
      <div className="filler-words-group">
        <span className="filler-words-label">{t('escalations.filler.builtIn')}</span>
        <ul className="filler-words-list" data-testid="filler-words-built-in">
          {BUILT_IN_FILLER_WORDS.map((w) => (
            <li key={w} className="escalation-chip is-locked">{w}</li>
          ))}
        </ul>
        <p className="muted filler-words-note">{t('escalations.filler.builtInRules')}</p>
      </div>
      <div className="filler-words-group">
        <span className="filler-words-label">{t('escalations.filler.yours')}</span>
        {own.length === 0 ? (
          <p className="muted" data-testid="filler-words-none">{t('escalations.filler.none')}</p>
        ) : (
          <ul className="filler-words-list" data-testid="filler-words-own">
            {own.map((w) => (
              <li key={w.id} className="escalation-chip" data-testid={`filler-word-${w.id}`}>
                <span dir="auto">{w.word}</span>
                <DeleteButton
                  size="sm"
                  armed={armedId === w.id}
                  label={t('escalations.filler.remove', { word: w.word })}
                  confirm={t('admin.org.confirmDelete')}
                  disabled={remove.isPending}
                  onClick={() => onRemove(w.id)}
                  data-testid={`filler-word-remove-${w.id}`}
                />
              </li>
            ))}
          </ul>
        )}
        <form className="org-add-form filler-words-add" onSubmit={onAdd} data-testid="filler-word-form">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('escalations.filler.placeholder')}
            aria-label={t('escalations.filler.add')}
            maxLength={100}
            dir="auto"
            data-testid="filler-word-input"
          />
          <Button variant="primary" type="submit" icon="plus" busy={add.isPending} disabled={!text.trim()} data-testid="filler-word-add">
            {t('escalations.filler.add')}
          </Button>
        </form>
      </div>
    </div>
  )
}
