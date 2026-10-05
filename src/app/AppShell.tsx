import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { usePermissions } from './permissions'
import { useDevPreview } from './dev-preview'
import { DevPanel } from './DevPanel'
import { ViewAsBanner } from './ViewAsBanner'
import { visibleSections } from './nav-config'
import { NavIcon } from './NavIcon'
import { APP_VERSION } from '../lib/version'
import { SendFeedbackDialog } from '../features/feedback/components/SendFeedbackDialog'
import { UserMenu } from './UserMenu'
import { NotificationInbox } from '../features/notifications/NotificationInbox'
import { useWorkChannel } from './work-channel'
import { useTrackOrigin } from '../lib/navigation/origin'
import { EnvironmentBanner } from './EnvironmentBanner'
import { UpdateBar } from './UpdateBar'
import { NewRequestDoor } from '../features/intake/components/NewRequestDoor'
import { Button } from '../components/Button'
import { useRememberedLocale } from './use-remembered-locale'
import { useStackedTables } from '../lib/dom/stacked-tables'
import { UploadTray } from './UploadTray'

/**
 * App shell (design concept E2EV1.pen, component `SidebarLight`): a light 248px sidebar with the
 * Maestro logo, grant-scoped nav in sections, and the user block pinned at the
 * bottom; a light topbar with search + version + feedback + locale. Nav is
 * grant-driven (ADR-0008) — items a role lacks are absent, not hidden (§2.3).
 */
export function AppShell() {
  const { t } = useTranslation()
  useWorkChannel()
  // ADR-0132 d.7: every page visited is remembered, so Back returns to where a person came from.
  useTrackOrigin()
  const toggleLocale = useRememberedLocale()
  // Every data table turns into labelled cards below 768px (index.css, `[data-stacked]`).
  useStackedTables()
  const navigate = useNavigate()
  const { can, roleName } = usePermissions()
  const { active: previewing, clear: clearPreview, canUseDevPanel } = useDevPreview()
  const sections = visibleSections(can)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar-logo" aria-label={t('app.name')} data-testid="shell-home">
          <span className="sidebar-mark">
            <img src="/maestro-mark.png" alt="" width="24" height="19" />
          </span>
          <span className="sidebar-word">{t('app.name')}</span>
        </Link>
        <span className="sidebar-suite">{t('app.suite')}</span>

        <nav className="sidebar-nav" aria-label="primary">
          {/* ADR-0122 (I61): Dashboard is one page for everyone — the view follows the person's reach. */}
          <NavLink to="/dashboard" end className="nav-item nav-home" data-testid="nav-dashboard">
            <NavIcon name="dashboard" />
            <span>{t('nav.dashboard')}</span>
          </NavLink>
          {sections.map((sec) => (
            <div className="nav-section" key={sec.titleKey}>
              <span className="nav-section-title">{t(sec.titleKey)}</span>
              {sec.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="nav-item"
                  data-testid={`nav-${item.to.slice(1).replace(/\//g, '-')}`}
                >
                  <NavIcon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <UserMenu />
        </div>
      </aside>

      <div className="shell-body">
        {/* Above the topbar, pushing the page down rather than covering it: a tab running last
            week's code is a statement about the page itself, not a notification (Edward, 6 Sep). */}
        {/* ADR-0081. Above UpdateBar, and for a stronger version of the same reason: an update is
            news you can dismiss once you have heard it, while WHICH DATABASE you are connected to is
            a standing fact about the screen. Its absence is meaningful too — no bar means
            production. */}
        <EnvironmentBanner />
        <UpdateBar />
        <header className="topbar">
          {/* Global search is not wired yet (M7.5) — hidden for the pilot rather
              than shown as a dead control. Restore when it does something. */}
          <div className="topbar-right">
            <span className="badge badge-alpha" data-testid="alpha-badge" title={t('badge.devNote')}>
              {t('badge.alpha')} V {APP_VERSION}
            </span>
            <NotificationInbox />
            <Button variant="link" data-testid="feedback-open" onClick={() => setFeedbackOpen(true)}>
              {t('feedback.open')}
            </Button>
            <Button
              variant="link"
              data-testid="locale-toggle"
              onClick={toggleLocale}
            >
              {t('nav.language')}
            </Button>
          </div>
        </header>
        <ViewAsBanner />
        {previewing && (
          <div className="preview-banner" role="status" data-testid="preview-banner">
            <span>{t('dev.previewingAs', { role: roleName ?? '' })}</span>
            <Button
              variant="link"
              data-testid="preview-banner-exit"
              onClick={() => { clearPreview(); navigate('/') }}
            >
              {t('dev.exit')}
            </Button>
          </div>
        )}
        <main className="shell-main">
          <Outlet />
        </main>
      </div>

      {feedbackOpen && <SendFeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {/* ADR-0082: the one door. Shell-level because its shortcut works on every page; it
          renders nothing at all for anyone without projects:manage (d.4). */}
      <NewRequestDoor />
      {canUseDevPanel && <DevPanel />}
      {/* ADR-0134 d.14: uploads carry on anywhere — the LB-05 box and the corner card, mounted once. */}
      <UploadTray />
    </div>
  )
}
