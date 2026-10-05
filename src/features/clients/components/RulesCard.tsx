import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteButton } from '../../../components/Button'
import type { ClientRule } from '../../../lib/brief/rules'
import { useAttributeValues } from '../../admin/api/deliverable-types-api'
import { useSaveRules } from '../api/clients-api'
import { Card, Chip, FieldLabel } from './parts'

/**
 * The client's dos and don'ts (CL-v3-04; the Dos and don'ts tab of CV-02). Each names the languages it
 * applies in, from the organisation's own (ADR-0123 d.5); none named means every language. Once the
 * client is active they are LOCKED: only the account director (or the Power Admin) changes them, and the
 * database refuses anyone else. A campaign adds its own on top and never removes these (I56.6).
 */
export function RulesCard({ clientId, rules, locked, canEdit }: { clientId: string; rules: readonly ClientRule[]; locked: boolean; canEdit: boolean }) {
  const { t, i18n } = useTranslation()
  const save = useSaveRules()
  const values = useAttributeValues()
  const languages = (values.data ?? []).filter((v) => v.attribute === 'language' && v.isActive)
  const all = languages.map((l) => l.code)
  const labelOf = (code: string) => {
    const l = languages.find((x) => x.code === code)
    return (i18n.language === 'ar' && l?.labelAr) || l?.labelEn || code
  }
  const [kind, setKind] = useState<ClientRule['kind']>('do')
  const [text, setText] = useState('')
  const [langs, setLangs] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosen = langs ?? all
  const editable = canEdit && !locked

  const write = (next: ClientRule[], done?: () => void) => {
    setError(null)
    save.mutate({ id: clientId, rules: next }, {
      onSuccess: done,
      onError: (e) => setError(t((e as { code?: string }).code === '42501' ? 'clients.rules.lockedRefused' : 'clients.saveFailed')),
    })
  }
  const ruleOf = (k: ClientRule['kind'], s: string, l: string[]): ClientRule => ({
    kind: k, text: s.trim(), ...(l.length && l.length < all.length ? { languages: l } : {}),
  })

  function addOne() {
    if (!text.trim()) return
    write([...rules, ruleOf(kind, text, chosen)], () => { setText(''); setLangs(null); setKind('do') })
  }

  const codes = (r: ClientRule) => (r.languages?.length ? r.languages : all).map((c) => c.toUpperCase()).join(' · ')

  return (
    <Card
      title={t('clients.rules.title')}
      chip={locked ? <Chip tone="neutral" testId="client-rules-locked">{t('clients.rules.locked')}</Chip> : <Chip tone="neutral">{t('clients.wizard.skippable')}</Chip>}
      count={t('clients.wizard.added', { count: rules.length })}
      testId="client-rules"
    >
      {rules.map((r, i) => (
        <div key={i} className="cl-rule" data-testid={`client-rule-${i}`}>
          {editing === i ? (
            <RuleEdit
              rule={r}
              all={all}
              labelOf={labelOf}
              busy={save.isPending}
              onSave={(k, s, l) => write(rules.map((x, j) => (j === i ? ruleOf(k, s, l) : x)), () => setEditing(null))}
              onRemove={() => write(rules.filter((_, j) => j !== i), () => setEditing(null))}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <span className={`cl-tag ${r.kind === 'do' ? 'is-do' : 'is-dont'}`}>{t(r.kind === 'do' ? 'clients.rules.doTag' : 'clients.rules.dontTag')}</span>
              <span className="cl-rule-text" dir="auto">{r.text}</span>
              <span className="cl-rule-langs">{codes(r)}</span>
              {editable && (
                <button type="button" className="cl-link" onClick={() => setEditing(i)} data-testid={`client-rule-edit-${i}`}>{t('clients.edit')}</button>
              )}
            </>
          )}
        </div>
      ))}

      {editable && (
        <RuleFields
          kind={kind}
          text={text}
          langs={chosen}
          all={all}
          labelOf={labelOf}
          onKind={setKind}
          onText={setText}
          onLangs={setLangs}
          onEnter={addOne}
          idPrefix="client-rule-new"
          action={
            <button type="button" className="cl-back cl-add-go" onClick={addOne} disabled={!text.trim() || save.isPending} data-testid="client-rule-add">
              {t('clients.rules.add')}
            </button>
          }
        />
      )}
      {locked && <p className="cl-footnote">{t('clients.rules.lockedNote')}</p>}
      {error && <p className="cl-error" role="alert" data-testid="client-rules-error">{error}</p>}
    </Card>
  )
}

function RuleFields({ kind, text, langs, all, labelOf, onKind, onText, onLangs, onEnter, idPrefix, action }: {
  kind: ClientRule['kind']
  text: string
  langs: string[]
  all: string[]
  labelOf: (code: string) => string
  onKind: (k: ClientRule['kind']) => void
  onText: (s: string) => void
  onLangs: (l: string[]) => void
  onEnter: () => void
  idPrefix: string
  action: React.ReactNode
}) {
  const { t } = useTranslation()
  const toggle = (code: string) => onLangs(langs.includes(code) ? langs.filter((c) => c !== code) : all.filter((c) => c === code || langs.includes(c)))
  return (
    <div className="cl-add">
      <div className="cl-field is-fit">
        <FieldLabel label={t('clients.rules.kind')} />
        <div className="cl-pills">
          {(['do', 'dont'] as const).map((k) => (
            <button key={k} type="button" className="cl-pill" aria-pressed={kind === k} onClick={() => onKind(k)} data-testid={`${idPrefix}-kind-${k}`}>
              {t(k === 'do' ? 'clients.rules.do' : 'clients.rules.dont')}
            </button>
          ))}
        </div>
      </div>
      <div className="cl-field">
        <FieldLabel label={t('clients.rules.rule')} htmlFor={`${idPrefix}-text`} />
        <input id={`${idPrefix}-text`} className="cl-input" dir="auto" value={text} placeholder="…" onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }} data-testid={`${idPrefix}-text`} />
      </div>
      <div className="cl-field is-fit">
        <FieldLabel label={t('clients.rules.appliesIn')} />
        <div className="cl-pills">
          {all.map((code) => (
            <button key={code} type="button" className="cl-pill" aria-pressed={langs.includes(code)} onClick={() => toggle(code)} data-testid={`${idPrefix}-lang-${code}`}>
              {labelOf(code)}
            </button>
          ))}
        </div>
      </div>
      {action}
    </div>
  )
}

function RuleEdit({ rule, all, labelOf, busy, onSave, onRemove, onCancel }: {
  rule: ClientRule
  all: string[]
  labelOf: (code: string) => string
  busy: boolean
  onSave: (kind: ClientRule['kind'], text: string, langs: string[]) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState(rule.kind)
  const [text, setText] = useState(rule.text)
  const [langs, setLangs] = useState<string[]>(rule.languages?.length ? rule.languages : all)
  const [armed, setArmed] = useState(false)
  return (
    <div className="cl-item-edit">
      <RuleFields
        kind={kind}
        text={text}
        langs={langs}
        all={all}
        labelOf={labelOf}
        onKind={setKind}
        onText={setText}
        onLangs={setLangs}
        onEnter={() => onSave(kind, text, langs)}
        idPrefix="client-rule-edit"
        action={
          <div className="cl-check-actions cl-add-go">
            <button type="button" className="cl-link" disabled={busy || !text.trim()} onClick={() => onSave(kind, text, langs)} data-testid="client-rule-save">{t('clients.save')}</button>
            <button type="button" className="cl-link" onClick={onCancel}>{t('clients.cancel')}</button>
            <DeleteButton armed={armed} label={t('clients.rules.remove')} confirm={t('clients.confirmRemove')} disabled={busy}
              onClick={() => (armed ? onRemove() : setArmed(true))} data-testid="client-rule-remove" />
          </div>
        }
      />
    </div>
  )
}
