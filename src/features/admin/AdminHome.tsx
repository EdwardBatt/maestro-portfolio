import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { usePermissions } from '../../app/permissions'

/**
 * Admin landing (§2.4): a small, complete tool — cards for each admin area
 * the caller's role holds a view grant for (ADR-0008). Grows with L1.4
 * (resources), L1.5 (organization), L1.11 (roles & permissions).
 */
export function AdminHome() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  return (
    <section data-testid="surface-admin">
      <h1>{t('nav.admin')}</h1>
      <div className="admin-cards">
        {can('admin.users:view') && (
          <Link to="/admin/users" className="admin-card" data-testid="admin-card-users">
            <h2>{t('admin.users.title')}</h2>
            <p className="muted">{t('admin.users.cardHint')}</p>
          </Link>
        )}
        {can('admin.resources:view') && (
          <Link to="/admin/resources" className="admin-card" data-testid="admin-card-resources">
            <h2>{t('admin.resources.title')}</h2>
            <p className="muted">{t('admin.resources.cardHint')}</p>
          </Link>
        )}
        {can('admin.organization:view') && (
          <Link to="/admin/organization" className="admin-card" data-testid="admin-card-organization">
            <h2>{t('admin.org.title')}</h2>
            <p className="muted">{t('admin.org.cardHint')}</p>
          </Link>
        )}
        {can('admin.organization:view') && (
          <Link to="/admin/deliverable-types" className="admin-card" data-testid="admin-card-deliverable-types">
            <h2>{t('admin.deliverableTypes.title')}</h2>
            <p className="muted">{t('admin.deliverableTypes.cardHint')}</p>
          </Link>
        )}
        {can('admin.organization:view') && (
          <Link to="/admin/workflow-templates" className="admin-card" data-testid="admin-card-workflow-templates">
            <h2>{t('admin.workflowTemplates.title')}</h2>
            <p className="muted">{t('admin.workflowTemplates.cardHint')}</p>
          </Link>
        )}
        {can('admin.roles:view') && (
          <Link to="/admin/roles" className="admin-card" data-testid="admin-card-roles">
            <h2>{t('admin.roles.title')}</h2>
            <p className="muted">{t('admin.roles.cardHint')}</p>
          </Link>
        )}
        {can('audit:view') && (
          <Link to="/admin/audit" className="admin-card" data-testid="admin-card-audit">
            <h2>{t('admin.audit.title')}</h2>
            <p className="muted">{t('admin.audit.cardHint')}</p>
          </Link>
        )}
        {can('admin.feedback:view') && (
          <Link to="/admin/feedback" className="admin-card" data-testid="admin-card-feedback">
            <h2>{t('admin.feedback.title')}</h2>
            <p className="muted">{t('admin.feedback.cardHint')}</p>
          </Link>
        )}
      </div>
    </section>
  )
}
