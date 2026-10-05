import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectory, type DirectoryGroup } from './api/directory-api'
import { roleName } from '../../lib/roles/role-text'

/**
 * Company Directory (L1.20, ADR-0017). Read-only listing of registered employees
 * grouped by department — full name, nickname, email. Gated by `directory:view`.
 * A client-side filter narrows across name / nickname / email / department.
 */
export function DirectoryPage() {
  const { t } = useTranslation()
  const dir = useDirectory()
  const [q, setQ] = useState('')

  const groups = useMemo<DirectoryGroup[]>(() => {
    const term = q.trim().toLowerCase()
    const all = dir.data ?? []
    if (!term) return all
    return all
      .map((g) => ({
        ...g,
        people: g.people.filter((p) =>
          [p.fullName, p.jobTitle, roleName(t, { key: p.roleKey, name: p.roleName }), p.officeName, p.nickname, p.email, g.departmentName]
            .filter(Boolean)
            .some((s) => s!.toLowerCase().includes(term)),
        ),
      }))
      .filter((g) => g.people.length > 0)
  }, [dir.data, q, t])

  const total = useMemo(
    () => (dir.data ?? []).reduce((n, g) => n + g.people.length, 0),
    [dir.data],
  )
  // I49.78: while a search narrows the list, the count says so — "3 of 20 people" — as the
  // deliverables page does; without one it is the whole directory.
  const shown = useMemo(() => groups.reduce((n, g) => n + g.people.length, 0), [groups])
  const searching = q.trim().length > 0

  if (dir.isLoading) return <p data-testid="directory-loading">…</p>
  if (dir.isError) return <p className="form-error">{t('directory.loadFailed')}</p>

  return (
    <section data-testid="surface-directory">
      <header className="schedule-bar">
        <h1>{t('directory.title')}</h1>
        <span className="muted" data-testid="directory-count">
          {searching ? t('directory.countOf', { shown, total }) : t('directory.count', { count: total })}
        </span>
      </header>
      <p className="muted">{t('directory.intro')}</p>

      <input
        type="search"
        className="directory-filter"
        placeholder={t('directory.searchPlaceholder')}
        aria-label={t('directory.searchPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="directory-search"
      />

      {groups.length === 0 && (
        <p className="muted" data-testid="directory-empty">
          {q.trim() ? t('directory.noMatches') : t('directory.empty')}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.departmentId ?? '__none__'} className="directory-group" data-testid={`directory-group-${g.departmentId ?? 'none'}`}>
          <h2 className="directory-dept">
            {g.departmentName ?? t('directory.unassigned')}{' '}
            <span className="muted">({g.people.length})</span>
          </h2>
          <table className="data-table directory-table" data-testid="directory-table">
            <colgroup>
              <col className="dc-name" />
              <col className="dc-title" />
              <col className="dc-role" />
              <col className="dc-office" />
              <col className="dc-nick" />
              <col className="dc-email" />
            </colgroup>
            <thead>
              <tr>
                <th>{t('directory.name')}</th>
                <th>{t('directory.jobTitle')}</th>
                <th>{t('directory.role')}</th>
                <th>{t('directory.office')}</th>
                <th>{t('directory.nickname')}</th>
                <th>{t('directory.email')}</th>
              </tr>
            </thead>
            <tbody>
              {g.people.map((p) => (
                <tr key={p.id} data-testid={`directory-row-${p.id}`}>
                  <td>{p.fullName}</td>
                  <td>{p.jobTitle ?? '—'}</td>
                  <td>{roleName(t, { key: p.roleKey, name: p.roleName }) || '—'}</td>
                  <td>{p.officeName ?? '—'}</td>
                  <td>{p.nickname ?? '—'}</td>
                  <td>
                    {p.email ? (
                      // Emails stay LTR even under RTL (§ RTL rules).
                      <a href={`mailto:${p.email}`} dir="ltr" className="directory-email">
                        {p.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
