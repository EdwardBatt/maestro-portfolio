import { NoticeDialog } from '../../components/Notice'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import { Button, IconButton } from '../../components/Button'
import {
  useAttributeValues,
  useCreateAttributeValue,
  useCreateDeliverableType,
  useDeliverableCategories,
  useDeliverableTypes,
  useSaveAttributeValue,
  useSaveDeliverableType,
  type DeliverableType,
} from './api/deliverable-types-api'
import { useSetTypeWorkflowTemplate, useWorkflowTemplates } from './api/workflow-templates-api'
import { Link } from 'react-router'

/**
 * Admin → Deliverable types (ADR-0051, I18.4).
 *
 * The list a tenant starts with is 16 categories and 240 types, seeded from the industry taxonomy.
 * It is a **starting point, not a contract**: rename anything, deactivate what this agency does not
 * do, add codes of your own. That is the whole difference between this and the six seeded
 * `work_types` ADR-0050 threw out — a taxonomy describes artefacts, so seeding it tells nobody how
 * to organise themselves.
 *
 * **Deactivate, never delete.** A type is a record of what was agreed on work already done, and
 * `deliverables.deliverable_type_id` would refuse the delete anyway. Deactivating removes it from
 * every picker; deliverables already carrying it keep displaying it.
 *
 * 240 rows is too many to scan, so the table is filtered by category and searched by text. The
 * count is always shown, because "no rows" after a filter and "no rows at all" look identical
 * otherwise.
 */
export function DeliverableTypesPage() {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const categories = useDeliverableCategories()
  const types = useDeliverableTypes()
  const attributes = useAttributeValues()
  const saveType = useSaveDeliverableType()
  const createType = useCreateDeliverableType()
  const saveValue = useSaveAttributeValue()
  const createValue = useCreateAttributeValue()
  // I19.11: the join the whole of ADR-0052 hangs on. Until this existed, every type held a null
  // template and setting a type on a deliverable materialised no tasks at all.
  const templates = useWorkflowTemplates()
  const setTemplate = useSetTypeWorkflowTemplate()

  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<DeliverableType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newType, setNewType] = useState({ code: '', categoryCode: '', nameEn: '', nameAr: '' })
  const [attribute, setAttribute] = useState('channel')
  const [newValue, setNewValue] = useState({ code: '', labelEn: '', labelAr: '' })

  // `types.data` is a stable reference from react-query; the `?? []` fallback is what changes
  // every render, so the memo keys on the query result and defaults inside.
  const shown = useMemo(() => {
    const allTypes = types.data ?? []
    const q = search.trim().toLowerCase()
    return allTypes.filter(
      (x) =>
        (!category || x.categoryCode === category) &&
        (!q || x.code.toLowerCase().includes(q) || x.nameEn.toLowerCase().includes(q) || (x.nameAr ?? '').includes(q)),
    )
  }, [types.data, category, search])

  const values = (attributes.data ?? []).filter((v) => v.attribute === attribute)
  const activeTemplates = (templates.data ?? []).filter((w) => w.isActive)
  // Counted over the WHOLE list, not the filtered view: "how much of the taxonomy actually
  // produces a task list" is a fact about the tenant, not about the current search box.
  const allTypes = types.data ?? []
  const withTemplate = allTypes.filter((x) => x.defaultWorkflowTemplateId).length

  function fail(e: unknown, fallback: string) {
    setError((e as { message?: string })?.message || fallback)
  }

  if (types.isError || categories.isError || attributes.isError) {
    return (
      <section className="page">
        <p className="form-error" data-testid="deliverable-types-error">{t('admin.deliverableTypes.loadFailed')}</p>
      </section>
    )
  }

  return (
    <section className="page" data-testid="surface-deliverable-types">
      <header className="page-head">
        <h1>{t('admin.deliverableTypes.title')}</h1>
        <p className="muted">{t('admin.deliverableTypes.intro')}</p>
      </header>

      {error && (
        <NoticeDialog kind="error" message={error} testId="deliverable-types-save-error" onClose={() => setError(null)} />
      )}

      {/* --- the types ---------------------------------------------------------- */}
      <h2 className="org-section-heading">{t('admin.deliverableTypes.typesHeading')}</h2>

      {/* I19.11. The count is stated because zero is the state this shipped in, and a screen that
          shows a picker without saying how much of the list is still unset makes that invisible. */}
      <p className="muted" data-testid="type-template-coverage">
        {t('admin.deliverableTypes.templateCoverage', { withTemplate, total: allTypes.length })}
        {' '}
        <Link to="/admin/workflow-templates">{t('admin.deliverableTypes.manageTemplates')}</Link>
      </p>

      <div className="filter-row">
        <label>
          {t('admin.deliverableTypes.category')}
          <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="type-filter-category">
            <option value="">{t('admin.deliverableTypes.allCategories')}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.code}>{c.code} — {c.nameEn}</option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.deliverableTypes.search')}
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="type-search" />
        </label>
        {/* Always shown: "nothing matches" and "nothing exists" are indistinguishable without it. */}
        <span className="muted" data-testid="type-count">
          {t('admin.deliverableTypes.count', { shown: shown.length, total: (types.data ?? []).length })}
        </span>
      </div>

      <table className="data-table" data-testid="deliverable-types-table">
        <thead>
          <tr>
            <th>{t('admin.deliverableTypes.code')}</th>
            <th>{t('admin.deliverableTypes.nameEn')}</th>
            <th>{t('admin.deliverableTypes.nameAr')}</th>
            <th>{t('admin.deliverableTypes.workflow')}</th>
            <th>{t('admin.deliverableTypes.status')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.id} data-testid={`deliverable-type-${x.code}`} className={x.isActive ? '' : 'is-inactive'}>
              <td><code>{x.code}</code></td>
              <td>
                {editing?.id === x.id ? (
                  <input
                    value={editing.nameEn}
                    onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                    data-testid="type-edit-name-en"
                  />
                ) : (
                  x.nameEn
                )}
              </td>
              <td dir="rtl">
                {editing?.id === x.id ? (
                  <input
                    value={editing.nameAr ?? ''}
                    onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
                    data-testid="type-edit-name-ar"
                  />
                ) : (
                  x.nameAr || <span className="muted">{t('admin.deliverableTypes.noArabic')}</span>
                )}
              </td>
              {/* Saves on change rather than behind the Rename editor: this is the one field an
                  admin comes to this screen to set in bulk, and burying it two clicks deep in an
                  edit mode is how 240 rows stay unset. */}
              <td>
                <select
                  value={x.defaultWorkflowTemplateId ?? ''}
                  disabled={setTemplate.isPending}
                  aria-label={t('admin.deliverableTypes.workflowFor', { code: x.code })}
                  onChange={(e) =>
                    setTemplate.mutate(
                      { typeId: x.id, templateId: e.target.value || null },
                      { onError: (err) => fail(err, t('admin.deliverableTypes.saveFailed')) },
                    )
                  }
                  data-testid={`type-workflow-${x.code}`}
                >
                  <option value="">{t('admin.deliverableTypes.noWorkflow')}</option>
                  {activeTemplates.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.nameEn}</option>
                  ))}
                </select>
              </td>
              <td>
                {x.isActive
                  ? t('admin.deliverableTypes.active')
                  : <span className="muted">{t('admin.deliverableTypes.inactive')}</span>}
              </td>
              <td className="row-actions">
                {editing?.id === x.id ? (
                  <>
                    <Button variant="primary"
                      busy={saveType.isPending}
                      onClick={() =>
                        saveType.mutate(
                          { id: editing.id, nameEn: editing.nameEn, nameAr: editing.nameAr },
                          {
                            onSuccess: () => { setEditing(null); setError(null) },
                            onError: (e) => fail(e, t('admin.deliverableTypes.saveFailed')),
                          },
                        )
                      }
                      data-testid="type-edit-save"
                    >
                      {t('common.save')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)} data-testid="type-edit-cancel">
                      {t('common.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <IconButton icon="edit" label={t('admin.deliverableTypes.rename')} onClick={() => setEditing(x)} data-testid={`type-edit-${x.code}`} />
                    <Button
                      variant="secondary" size="sm"
                      onClick={() =>
                        saveType.mutate(
                          { id: x.id, isActive: !x.isActive },
                          { onError: (e) => fail(e, t('admin.deliverableTypes.saveFailed')) },
                        )
                      }
                      data-testid={`type-toggle-${x.code}`}
                    >
                      {x.isActive ? t('admin.deliverableTypes.deactivate') : t('admin.deliverableTypes.reactivate')}
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* --- add a type --------------------------------------------------------- */}
      <h3 className="org-section-heading">{t('admin.deliverableTypes.addType')}</h3>
      <p className="muted">{t('admin.deliverableTypes.addTypeNote')}</p>
      <form
        className="inline-form"
        data-testid="add-type-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!claims.tenantId || !newType.code.trim() || !newType.categoryCode || !newType.nameEn.trim()) return
          createType.mutate(
            { tenantId: claims.tenantId, ...newType },
            {
              onSuccess: () => { setNewType({ code: '', categoryCode: '', nameEn: '', nameAr: '' }); setError(null) },
              onError: (e2) => fail(e2, t('admin.deliverableTypes.addFailed')),
            },
          )
        }}
      >
        <input
          placeholder={t('admin.deliverableTypes.code')}
          value={newType.code}
          onChange={(e) => setNewType({ ...newType, code: e.target.value })}
          data-testid="add-type-code"
        />
        <select
          value={newType.categoryCode}
          onChange={(e) => setNewType({ ...newType, categoryCode: e.target.value })}
          data-testid="add-type-category"
        >
          <option value="">{t('admin.deliverableTypes.chooseCategory')}</option>
          {(categories.data ?? []).filter((c) => c.isActive).map((c) => (
            <option key={c.id} value={c.code}>{c.code} — {c.nameEn}</option>
          ))}
        </select>
        <input
          placeholder={t('admin.deliverableTypes.nameEn')}
          value={newType.nameEn}
          onChange={(e) => setNewType({ ...newType, nameEn: e.target.value })}
          data-testid="add-type-name-en"
        />
        <input
          placeholder={t('admin.deliverableTypes.nameAr')}
          dir="rtl"
          value={newType.nameAr}
          onChange={(e) => setNewType({ ...newType, nameAr: e.target.value })}
          data-testid="add-type-name-ar"
        />
        <Button variant="primary" busy={createType.isPending} type="submit" data-testid="add-type-submit">
          {t('admin.deliverableTypes.add')}
        </Button>
      </form>

      {/* --- the attribute lists ------------------------------------------------ */}
      <h2 className="org-section-heading">{t('admin.deliverableTypes.attributesHeading')}</h2>
      <p className="muted">{t('admin.deliverableTypes.attributesIntro')}</p>

      <div className="filter-row">
      <label>
        {t('admin.deliverableTypes.attribute')}
        <select value={attribute} onChange={(e) => setAttribute(e.target.value)} data-testid="attribute-picker">
          {['channel', 'format', 'orientation', 'production_type', 'complexity', 'client_approval', 'language'].map((a) => (
            <option key={a} value={a}>{t(`admin.deliverableTypes.attr.${a}`)}</option>
          ))}
        </select>
      </label>
      </div>

      <table className="data-table" data-testid="attribute-values-table">
        <thead>
          <tr>
            <th>{t('admin.deliverableTypes.code')}</th>
            <th>{t('admin.deliverableTypes.nameEn')}</th>
            <th>{t('admin.deliverableTypes.nameAr')}</th>
            <th>{t('admin.users.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => (
            <tr key={v.id} data-testid={`attribute-value-${v.code}`} className={v.isActive ? '' : 'is-inactive'}>
              <td><code>{v.code}</code></td>
              <td>{v.labelEn}</td>
              <td dir="rtl">{v.labelAr || <span className="muted">{t('admin.deliverableTypes.noArabic')}</span>}</td>
              <td className="row-actions">
                <Button
                  variant="secondary" size="sm"
                  onClick={() =>
                    saveValue.mutate(
                      { id: v.id, isActive: !v.isActive },
                      { onError: (e) => fail(e, t('admin.deliverableTypes.saveFailed')) },
                    )
                  }
                  data-testid={`attribute-toggle-${v.code}`}
                >
                  {v.isActive ? t('admin.deliverableTypes.deactivate') : t('admin.deliverableTypes.reactivate')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="inline-form"
        data-testid="add-attribute-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!claims.tenantId || !newValue.code.trim() || !newValue.labelEn.trim()) return
          createValue.mutate(
            { tenantId: claims.tenantId, attribute, ...newValue },
            {
              onSuccess: () => { setNewValue({ code: '', labelEn: '', labelAr: '' }); setError(null) },
              onError: (e2) => fail(e2, t('admin.deliverableTypes.addFailed')),
            },
          )
        }}
      >
        <input
          placeholder={t('admin.deliverableTypes.code')}
          value={newValue.code}
          onChange={(e) => setNewValue({ ...newValue, code: e.target.value })}
          data-testid="add-attribute-code"
        />
        <input
          placeholder={t('admin.deliverableTypes.nameEn')}
          value={newValue.labelEn}
          onChange={(e) => setNewValue({ ...newValue, labelEn: e.target.value })}
          data-testid="add-attribute-name-en"
        />
        <input
          placeholder={t('admin.deliverableTypes.nameAr')}
          dir="rtl"
          value={newValue.labelAr}
          onChange={(e) => setNewValue({ ...newValue, labelAr: e.target.value })}
          data-testid="add-attribute-name-ar"
        />
        <Button variant="primary" busy={createValue.isPending} type="submit" data-testid="add-attribute-submit">
          {t('admin.deliverableTypes.add')}
        </Button>
      </form>
    </section>
  )
}
