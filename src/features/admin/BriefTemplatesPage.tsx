import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../components/Button'
import {
  useSetDefaultDepartmentBrief,
  useSetDepartmentTemplate,
  useBriefTemplates,
  useCreateBriefTemplate,
  useSaveBriefTemplate,
  slugForBriefType,
  type BriefTemplate,
  type BriefTemplateField,
} from './api/brief-templates-api'
import { useDepartments } from './api/admin-api'
import { useAuth } from '../../app/auth-context'

/**
 * Admin → Brief templates (ADR-0048 d.2, I16.1).
 *
 * One job: **what does each brief type contain?** The field list, its labels in both languages,
 * and the guidance line — which is the model's prompt as much as the human's hint, so the screen
 * says so rather than letting somebody edit it as though it were copy.
 *
 * It used to carry a second table, mapping each discipline to a template. That was ADR-0048 d.5
 * machinery over a `work_types.brief_type` column that was never built; ADR-0050 d.4 put the brief
 * type on `campaign_briefs`, chosen per department by the account manager, and the mapping is
 * deleted rather than repaired (the reading ADR-0056 d.12 records). Nothing resolves a discipline
 * to a template any more, so there is nothing for an administrator to set here.
 *
 * **The mapping came back on 30 Aug, correctly this time.** A DEPARTMENT points at a template, the
 * tenant sets it, and nothing is inferred from a name — Edward: *"this is a multitenant system, so
 * we need to accept not everyone uses the same org structure and names their departments
 * differently. We also need to be able to create new templates and assign them as required."* So
 * this screen now does three things it could not: name a template, create one, and say which
 * departments write their briefs from it.
 *
 * The titles were wrong too. They lived here as i18n keys and read "360 Campaign" and "Paid media /
 * performance" where the agency's own deck says **Creative Brief** and **Performance Brief** — and
 * a key cannot exist at all for a template a tenant creates. The name is data now.
 */
export function BriefTemplatesPage() {
  const { t } = useTranslation()
  const templates = useBriefTemplates()
  const departments = useDepartments()
  const save = useSaveBriefTemplate()
  const create = useCreateBriefTemplate()
  const setAllowed = useSetDepartmentTemplate()
  const setDefault = useSetDefaultDepartmentBrief()
  const { claims } = useAuth()
  const [open, setOpen] = useState<string | null>(null)
  // Which template's department list is open. Separate from `open` (the field editor) because they
  // answer different questions and reading one should not close the other.
  const [assigning, setAssigning] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  // I54.3 (Edward, 23 Sep: "we need Arabic and English..always"). A template created with an
  // English name only shows that name to an Arabic reader for ever, because nothing else on
  // this screen could ever set it.
  const [newNameAr, setNewNameAr] = useState('')
  // I49.81 (B): a new template may start from another one's fields — '' is "start empty".
  const [copyFrom, setCopyFrom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rows = templates.data ?? []

  // A failed read is not an empty list, and the two must never look alike. Eleven templates went
  // blank when an ambiguous embed made PostgREST reject the whole select, and the screen said
  // nothing at all — the exact failure this codebase keeps writing down and repeating.
  if (templates.isError) {
    return (
      <section className="page">
        <header className="page-head">
          <h1>{t('admin.briefTemplates.title')}</h1>
        </header>
        <p className="form-error" role="alert" data-testid="brief-templates-load-failed">
          {t('admin.briefTemplates.loadFailed')}{' '}
          <span data-testid="brief-templates-load-failed-reason">
            {failureText(templates.error)}
          </span>
        </p>
      </section>
    )
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('admin.briefTemplates.title')}</h1>
        <p className="muted">{t('admin.briefTemplates.intro')}</p>
      </header>

      {/* --- what each brief contains ------------------------------------------ */}
      <h2 className="org-section-heading">{t('admin.briefTemplates.fieldsHeading')}</h2>
      <p className="muted">{t('admin.briefTemplates.guidanceWarning')}</p>
      <table className="data-table" data-testid="brief-templates">
        <thead>
          <tr>
            <th>{t('admin.briefTemplates.template')}</th>
            <th>{t('admin.briefTemplates.departments')}</th>
            <th>{t('admin.briefTemplates.fieldCount')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
            <tr data-testid={`brief-template-${r.briefType}`}>
              <td>
                {r.nameEn}
                {r.nameAr && <span className="muted" dir="rtl"> · {r.nameAr}</span>}
              </td>
              {/* Which departments write their briefs from this one. Read from the template's end,
                  stored on the department, so two can share it. */}
              <td data-testid={`brief-template-departments-${r.briefType}`}>
                {r.departments.length === 0
                  ? <span className="muted">{t('admin.briefTemplates.noDepartments')}</span>
                  /* A department that writes this one BY DEFAULT is marked, because "which brief
                     does Creative actually use?" is the question this screen is opened to answer
                     and a bare list of names never answered it. */
                  : r.departments
                      .map((d) => (d.isDefault ? `${d.name} (${t('admin.briefTemplates.isDefault')})` : d.name))
                      .join(', ')}
              </td>
              <td>
                {r.fields.length}
                {r.fields.length === 0 && (
                  <span className="muted" data-testid={`brief-template-empty-${r.briefType}`}>
                    {' '}
                    {t('admin.briefTemplates.emptyNote')}
                  </span>
                )}
              </td>
              <td className="row-actions">
                <Button
                  variant="secondary" size="sm"
                  onClick={() => setAssigning(assigning === r.id ? null : r.id)}
                  data-testid={`brief-template-assign-open-${r.briefType}`}
                >
                  {assigning === r.id ? t('admin.briefTemplates.close') : t('admin.briefTemplates.assign')}
                </Button>
                <Button
                  variant="secondary" size="sm" icon="edit"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  data-testid={`brief-template-edit-${r.briefType}`}
                >
                  {open === r.id ? t('admin.briefTemplates.close') : t('admin.briefTemplates.edit')}
                </Button>
              </td>
            </tr>
            {/* Which departments write from THIS brief — the question asked from the template's
                side, because that is how somebody thinks about it: "who uses the Production
                brief?" Several departments may share one, so it is a checklist and not a single
                choice. A department writes from exactly one template, so ticking it here moves it
                off whatever it was on — and the row says which, rather than moving it silently. */}
            {assigning === r.id && (
              <tr data-testid={`brief-template-assign-row-${r.briefType}`}>
                <td colSpan={5}>
                  <p className="muted">{t('admin.briefTemplates.assignIntro')}</p>
                  <p className="muted">{t('admin.briefTemplates.defaultIntro')}</p>
                  <div className="check-grid">
                    {(departments.data ?? []).map((d) => {
                      const on = r.departments.some((x) => x.id === d.id)
                      const others = rows.filter(
                        (o) => o.id !== r.id && o.departments.some((x) => x.id === d.id),
                      ).length
                      const isDefaultHere = r.departments.some((x) => x.id === d.id && x.isDefault)
                      return (
                        <label className="check" key={d.id}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!claims.tenantId}
                            onChange={(e) =>
                              setAllowed.mutate(
                                {
                                  tenantId: claims.tenantId!,
                                  departmentId: d.id,
                                  briefTemplateId: r.id,
                                  allowed: e.target.checked,
                                },
                                { onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)) },
                              )
                            }
                            data-testid={`brief-template-assign-${r.briefType}-${d.id}`}
                          />
                          {d.name}
                          {/* How many OTHER briefs this department may already use. Adding one
                              never takes another away — that was the defect in the first
                              attempt — so this is information, not a warning. */}
                          {others > 0 && (
                            <span className="muted"> · {t('admin.briefTemplates.alsoUses', { count: others })}</span>
                          )}
                          {/* Only where there is something to choose BETWEEN. A department with one
                              brief already writes it without being asked, so offering to make it
                              the default would be offering to change nothing. */}
                          {on && others > 0 && (
                            <Button
                              variant="link"
                              onClick={() =>
                                setDefault.mutate(
                                  {
                                    departmentId: d.id,
                                    briefTemplateId: isDefaultHere ? null : r.id,
                                  },
                                  { onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)) },
                                )
                              }
                              data-testid={`brief-template-default-${r.briefType}-${d.id}`}
                            >
                              {isDefaultHere
                                ? t('admin.briefTemplates.clearDefault')
                                : t('admin.briefTemplates.makeDefault')}
                            </Button>
                          )}
                          {isDefaultHere && (
                            <span className="badge badge-system" data-testid={`brief-template-is-default-${r.briefType}-${d.id}`}>
                              {t('admin.briefTemplates.isDefault')}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                  {(departments.data ?? []).length === 0 && (
                    <p className="muted">{t('admin.briefTemplates.noDepartmentsAtAll')}</p>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
          ))}
        </tbody>
      </table>

      {/* --- create one -------------------------------------------------------- */}
      {/* There was no way to make a template at all until 30 Aug: the screen could edit the eleven
          seeded rows' fields and nothing else, so a tenant whose work does not fit the agency's
          deck had no recourse. It arrives with NO fields unless started from another template
          (I49.81), which makes it unselectable (ADR-0048 d.2) — a template that silently
          generates an empty brief looks broken — and the person adds them in the editor. */}
      <div className="org-add-form" data-testid="brief-template-add">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('admin.briefTemplates.newName')}
          data-testid="brief-template-new-name"
        />
        <input
          value={newNameAr}
          onChange={(e) => setNewNameAr(e.target.value)}
          placeholder={t('admin.briefTemplates.newNameAr')}
          dir="rtl"
          data-testid="brief-template-new-name-ar"
        />
        <select
          value={copyFrom}
          onChange={(e) => setCopyFrom(e.target.value)}
          aria-label={t('admin.briefTemplates.copyFrom')}
          data-testid="brief-template-new-copy"
        >
          <option value="">{t('admin.briefTemplates.startEmpty')}</option>
          {rows.filter((r) => r.fields.length > 0).map((r) => (
            <option key={r.id} value={r.id}>{t('admin.briefTemplates.copyFromNamed', { name: r.nameEn })}</option>
          ))}
        </select>
        <Button variant="primary"
          type="button"
          busy={create.isPending}
          disabled={!newName.trim() || !claims.tenantId}
          onClick={() =>
            create.mutate(
              {
                tenantId: claims.tenantId!,
                nameEn: newName,
                nameAr: newNameAr.trim() || null,
                fields: copyFrom ? rows.find((r) => r.id === copyFrom)?.fields.map((f) => ({ ...f })) : undefined,
              },
              {
                onSuccess: () => { setNewName(''); setNewNameAr(''); setCopyFrom(''); setError(null) },
                onError: (e) => setError(e instanceof Error ? e.message : String(e)),
              },
            )
          }
          data-testid="brief-template-new-submit"
        >
          + {t('admin.briefTemplates.create')}
        </Button>
      </div>

      {error && <p className="form-error" data-testid="brief-templates-error">{error}</p>}

      {open && (
        <TemplateEditor
          template={rows.find((r) => r.id === open)!}
          busy={save.isPending}
          onSave={(patch) =>
            save.mutate(
              { id: open, ...patch },
              {
                onSuccess: () => { setOpen(null); setError(null) },
                onError: (e) => setError(e instanceof Error ? e.message : String(e)),
              },
            )
          }
          onCancel={() => setOpen(null)}
        />
      )}
    </section>
  )
}

/** What the editor hands back. `fields` was the whole of it until I54.3. */
export interface TemplatePatch {
  fields: BriefTemplateField[]
  nameEn: string
  nameAr: string | null
  descriptionEn: string | null
  descriptionAr: string | null
}

/**
 * Editing one template: its NAME, its DESCRIPTION and its field list.
 *
 * I54.3 — the name and description were not editable at all. A template took its English name at
 * creation and kept it for ever, had no Arabic name, and no description ever, which matters
 * because the description is the line each card shows on the first screen of the single-job flow.
 * Every template may be renamed, the twelve seeded ones included (Edward, 23 Sep): the key a brief
 * is stored under is derived once at creation and never moves, so a name is only a label.
 *
 * Presentational (AGENTS.md §4): it takes a template and hands back what to save. It does not know
 * what a mutation is.
 */
function TemplateEditor({
  template,
  busy,
  onSave,
  onCancel,
}: {
  template: BriefTemplate
  busy: boolean
  onSave: (patch: TemplatePatch) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [fields, setFields] = useState<BriefTemplateField[]>(template.fields)
  const [nameEn, setNameEn] = useState(template.nameEn)
  const [nameAr, setNameAr] = useState(template.nameAr ?? '')
  const [descriptionEn, setDescriptionEn] = useState(template.descriptionEn ?? '')
  const [descriptionAr, setDescriptionAr] = useState(template.descriptionAr ?? '')
  // I49.81 (A): the row that adds a field. Until 16 Sep the editor could relabel and remove and
  // nothing else, so a template created on this screen stayed at zero fields for ever.
  const [draft, setDraft] = useState({ en: '', ar: '', guidance: '' })
  const [addError, setAddError] = useState<string | null>(null)
  // The key is what a brief stores the answer under: made from the English label, unique here.
  const draftKey = slugForBriefType(draft.en)

  const update = (i: number, patch: Partial<BriefTemplateField>) =>
    setFields((prev) => prev.map((f, n) => (n === i ? { ...f, ...patch } : f)))

  function addField() {
    if (!draftKey) return
    if (fields.some((f) => f.key === draftKey)) {
      setAddError(t('admin.briefTemplates.fieldExists', { key: draftKey }))
      return
    }
    setFields((prev) => [...prev, { key: draftKey, en: draft.en.trim(), ar: draft.ar.trim(), guidance: draft.guidance.trim() }])
    setDraft({ en: '', ar: '', guidance: '' })
    setAddError(null)
  }

  return (
    <section className="brief-template-editor" data-testid="brief-template-editor">
      <h3 className="org-section-heading">{template.nameEn}</h3>

      {/* --- what it is called, and what the card says about it ---------------- */}
      {/* Both languages, always (Edward, 23 Sep). The key underneath never changes, so renaming
          cannot orphan a brief already written from this template. */}
      <div className="brief-template-naming" data-testid="brief-template-naming">
        <label className="field">
          <span className="field-label">{t('admin.briefTemplates.nameEn')}</span>
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            data-testid="brief-template-name-en"
          />
        </label>
        <label className="field">
          <span className="field-label">{t('admin.briefTemplates.nameAr')}</span>
          <input
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            dir="rtl"
            data-testid="brief-template-name-ar"
          />
        </label>
        <label className="field">
          <span className="field-label">{t('admin.briefTemplates.descriptionEn')}</span>
          <input
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
            placeholder={t('admin.briefTemplates.descriptionHint')}
            data-testid="brief-template-description-en"
          />
        </label>
        <label className="field">
          <span className="field-label">{t('admin.briefTemplates.descriptionAr')}</span>
          <input
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
            dir="rtl"
            data-testid="brief-template-description-ar"
          />
        </label>
      </div>
      <p className="muted">{t('admin.briefTemplates.namingNote')}</p>

      <p className="muted">{t('admin.briefTemplates.orderNote')}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('admin.briefTemplates.fieldKey')}</th>
            <th>{t('admin.briefTemplates.labelEn')}</th>
            <th>{t('admin.briefTemplates.labelAr')}</th>
            <th>{t('admin.briefTemplates.guidance')}</th>
            <th>{t('admin.briefTemplates.essential')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.key} data-testid={`brief-template-field-${f.key}`}>
              <td><code>{f.key}</code></td>
              <td>
                <input
                  value={f.en}
                  onChange={(e) => update(i, { en: e.target.value })}
                  data-testid={`brief-template-field-en-${f.key}`}
                />
              </td>
              <td>
                <input
                  value={f.ar}
                  onChange={(e) => update(i, { ar: e.target.value })}
                  data-testid={`brief-template-field-ar-${f.key}`}
                />
              </td>
              <td>
                <input
                  value={f.guidance}
                  onChange={(e) => update(i, { guidance: e.target.value })}
                  data-testid={`brief-template-field-guidance-${f.key}`}
                />
              </td>
              <td>
                {/* SJ-v3-02: the brief page shows the essentials first, the rest after. */}
                <input
                  type="checkbox"
                  checked={f.essential === true}
                  onChange={(e) => update(i, { essential: e.target.checked })}
                  aria-label={t('admin.briefTemplates.essential')}
                  data-testid={`brief-template-field-essential-${f.key}`}
                />
              </td>
              <td className="row-actions">
                <IconButton
                  icon="trash"
                  danger
                  size="sm"
                  label={t('campaigns.wizard.removeRow')}
                  onClick={() => setFields((prev) => prev.filter((_, n) => n !== i))}
                  data-testid={`brief-template-field-remove-${f.key}`}
                />
              </td>
            </tr>
          ))}
          {/* The add row: labels and guidance typed, the key shown as it will be stored. */}
          <tr className="brief-template-add-row" data-testid="brief-template-field-new">
            <td><code data-testid="brief-template-field-new-key">{draftKey || '—'}</code></td>
            <td>
              <input
                value={draft.en}
                onChange={(e) => setDraft((d) => ({ ...d, en: e.target.value }))}
                placeholder={t('admin.briefTemplates.labelEn')}
                data-testid="brief-template-field-new-en"
              />
            </td>
            <td>
              <input
                value={draft.ar}
                onChange={(e) => setDraft((d) => ({ ...d, ar: e.target.value }))}
                placeholder={t('admin.briefTemplates.labelAr')}
                data-testid="brief-template-field-new-ar"
              />
            </td>
            <td>
              <input
                value={draft.guidance}
                onChange={(e) => setDraft((d) => ({ ...d, guidance: e.target.value }))}
                placeholder={t('admin.briefTemplates.guidance')}
                data-testid="brief-template-field-new-guidance"
              />
            </td>
            <td />
            <td className="row-actions">
              <Button type="button" variant="secondary" size="sm" disabled={!draftKey} onClick={addField} data-testid="brief-template-field-add">
                + {t('admin.briefTemplates.addField')}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      {addError && <p className="form-error" data-testid="brief-template-field-add-error">{addError}</p>}
      {fields.length === 0 && <p className="muted" data-testid="brief-template-editor-empty">{t('admin.briefTemplates.noFieldsYet')}</p>}
      <div className="form-actions">
        <Button
          type="button"
          variant="primary"
          busy={busy}
          disabled={!nameEn.trim()}
          onClick={() =>
            onSave({
              fields,
              nameEn,
              nameAr: nameAr.trim() || null,
              descriptionEn: descriptionEn.trim() || null,
              descriptionAr: descriptionAr.trim() || null,
            })
          }
          data-testid="brief-template-save"
        >
          {t('admin.briefTemplates.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid="brief-template-cancel">
          {t('admin.briefTemplates.cancel')}
        </Button>
      </div>
    </section>
  )
}

/**
 * What a thrown query error reads as on screen.
 *
 * A PostgREST failure is a plain object with a `message`, not an `Error`, so `String(e)` renders
 * the literal text "[object Object]" — which is how this screen reported its own outage and told
 * nobody anything. The campaign page already had this function; it should have been shared the
 * first time rather than written badly a second.
 */
function failureText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error ?? '')
}
