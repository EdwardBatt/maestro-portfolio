import { Navigate, createBrowserRouter } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AppShell } from './AppShell'
import { PermissionsUnavailable, RequireAuth, RequirePermission } from './guards'
import { usePermissions } from './permissions'
import { LoginPage } from '../features/auth/LoginPage'
import { SetPasswordPage } from '../features/auth/SetPasswordPage'
import { SchedulePage } from '../features/schedule/SchedulePage'
import { RoleDashboardPage } from '../features/dashboard/RoleDashboardPage'
import { TaskListsWaitingPage } from '../features/deliverables/TaskListsWaitingPage'
import { UsersPage } from '../features/admin/UsersPage'
import { HandoverPage } from '../features/admin/HandoverPage'
import { ResourcesPage } from '../features/admin/ResourcesPage'
import { RolesPage } from '../features/admin/RolesPage'
import { AuditPage } from '../features/admin/AuditPage'
import { OrganizationPage } from '../features/admin/OrganizationPage'
import { BriefTemplatesPage } from '../features/admin/BriefTemplatesPage'
import { DeliverableTypesPage } from '../features/admin/DeliverableTypesPage'
import { WorkflowTemplatesPage } from '../features/admin/WorkflowTemplatesPage'
import { LeavePage } from '../features/leave/LeavePage'
import { DirectoryPage } from '../features/directory/DirectoryPage'
import { TeamPage } from '../features/team/TeamPage'
import { BookingsPage } from '../features/bookings/BookingsPage'
import { MyTasksPage } from '../features/bookings/MyTasksPage'
import { TaskPage } from '../features/deliverables/TaskPage'
import { CampaignsPage } from '../features/campaigns/CampaignsPage'
import { BriefWizard } from '../features/campaigns/BriefWizard'
import { SingleJobWizard } from '../features/intake/SingleJobWizard'
import { CampaignPage } from '../features/campaigns/CampaignPage'
import { PieceRedirect } from '../features/campaigns/PieceRedirect'
import { ChatPage } from '../features/chat/ChatPage'
import { DeliverablesPage } from '../features/deliverables/DeliverablesPage'
import { PipelinePage } from '../features/deliverables/PipelinePage'
import { ClientsPage } from '../features/clients/ClientsPage'
import { ClientPage } from '../features/clients/ClientPage'
import { ClientWizard } from '../features/clients/ClientWizard'
import { LibraryPage } from '../features/library/LibraryPage'
import { SlaProfilesPage } from '../features/sla/SlaProfilesPage'
import { FeedbackAdminPage } from '../features/feedback/FeedbackAdminPage'

function RoleLanding({ homeKey, testId }: { homeKey: string; testId: string }) {
  const { t } = useTranslation()
  return (
    <section data-testid={testId}>
      <p>{t(homeKey)}</p>
    </section>
  )
}

function IndexRedirect() {
  const { defaultRoute, ready, failed } = usePermissions()
  if (!ready) return null
  // A failed grant fetch leaves defaultRoute at its '/login' fallback; sending a
  // signed-in user there reads as a logout, so say what happened instead.
  if (failed) return <PermissionsUnavailable />
  // Role-aware landing (ADR-0008): each role's roles.default_route. Power Admin's
  // is /admin, which now renders the Overview dashboard.
  return <Navigate to={defaultRoute} replace />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Invite + reset emails land here with a token; the page itself decides
  // between the form (session established) and the invalid-link notice.
  { path: '/set-password', element: <SetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <IndexRedirect /> },
      {
        element: <AppShell />,
        children: [
          // ADR-0122 d.6 (I61.2): every signed-in person opens the Dashboard; the view is chosen from their reach
          // and permissions, and shows only what they already reach — so it needs no grant of its own.
          { path: '/dashboard', element: <RoleDashboardPage /> },
          // ADR-0133 (I70.4): a leaving person's hand-over. No grant of its own — it goes to their department lead, or the
          // Traffic Manager and the Power Admins, who hold different grants; the database answers only the people it names.
          { path: '/people/handover/:userId', element: <HandoverPage /> },
          {
            element: <RequirePermission perms={['my_tasks:view', 'my_calendar:view']} />,
            children: [
              { path: '/my-work', element: <MyTasksPage /> },
              // ADR-0105 d.3 (I59.11): one task's own page, under My Work and behind the same gate.
              { path: '/my-work/task/:taskId', element: <TaskPage /> },
              { path: '/chat', element: <ChatPage /> },
            ],
          },
          {
            element: <RequirePermission perms={['schedule:view']} />,
            children: [{ path: '/schedule', element: <SchedulePage /> }],
          },
          {
            element: <RequirePermission perms={['bookings_table:view']} />,
            children: [{ path: '/bookings', element: <BookingsPage /> }],
          },
          {
            // Read-only for everyone (Edward, 12 Sep): the campaigns list and a campaign's detail
            // are visible to any signed-in user; the RLS already allows the read.
            element: <RequirePermission perms={['projects:view']} />,
            children: [
              { path: '/campaigns', element: <CampaignsPage /> },
              // ADR-0048 d.9 / I16.6: one campaign, whole - the brief, the per-discipline
              // briefs, its deliverables and their tasks. Also the approval surface,
              // because approving a campaign means reading it — writes on it are RLS-gated.
              // I59.45: a notification about a deliverable opens its campaign (door.ts).
              { path: '/campaigns/piece/:deliverableId', element: <PieceRedirect /> },
              { path: '/campaigns/:campaignId', element: <CampaignPage /> },
            ],
          },
          {
            // Raising work stays with projects:manage.
            element: <RequirePermission perms={['projects:manage']} />,
            children: [
              { path: '/campaigns/new', element: <BriefWizard /> },
              // ADR-0082 d.5 / ADR-0083–0085: the single-job flow behind the one door. Same grant
              // as the wizard, because it creates the same kind of row (ADR-0083 d.3).
              { path: '/campaigns/new-job', element: <SingleJobWizard /> },
            ],
          },
          {
            element: <RequirePermission perms={['project_tasks:manage']} />,
            children: [
              { path: '/deliverables', element: <DeliverablesPage /> },
              // I66.6: the Dashboard's "Task lists not approved", one row per list, over the viewer's reach.
              { path: '/deliverables/task-lists', element: <TaskListsWaitingPage /> },
              { path: '/pipeline', element: <PipelinePage /> },
            ],
          },
          {
            element: <RequirePermission perms={['clients:view']} />,
            children: [
              { path: '/clients', element: <ClientsPage /> },
              // ADR-0123 (Figma CV-02): a client's page.
              { path: '/clients/:clientId', element: <ClientPage /> },
            ],
          },
          {
            // ADR-0123 d.1: anyone who manages clients starts and continues a draft; activating is
            // `clients:approve`, checked on the Review step and by the database.
            element: <RequirePermission perms={['clients:manage']} />,
            children: [
              { path: '/clients/new', element: <ClientWizard /> },
              { path: '/clients/:clientId/register', element: <ClientWizard /> },
            ],
          },
          {
            element: <RequirePermission perms={['assets:view']} />,
            children: [{ path: '/library', element: <LibraryPage /> }],
          },
          {
            element: <RequirePermission perms={['sla_profiles:manage']} />,
            children: [{ path: '/sla-profiles', element: <SlaProfilesPage /> }],
          },
          {
            element: <RequirePermission perms={['team:view']} />,
            children: [
              { path: '/team', element: <TeamPage /> },
            ],
          },
          // ADR-0122 d.6: the Dashboard left /admin. Roles that still land there (roles.default_route) are sent on.
          { path: '/admin', element: <Navigate to="/dashboard" replace /> },
          {
            element: <RequirePermission perms={['admin.users:view']} />,
            children: [{ path: '/admin/users', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission perms={['admin.resources:view']} />,
            children: [{ path: '/admin/resources', element: <ResourcesPage /> }],
          },
          {
            element: <RequirePermission perms={['admin.roles:view']} />,
            children: [{ path: '/admin/roles', element: <RolesPage /> }],
          },
          {
            // ADR-0048 d.2: brief templates are organisation configuration, behind the same
            // grant that edits roles and offices.
            element: <RequirePermission perms={['admin.organization:view']} />,
            children: [{ path: '/admin/brief-templates', element: <BriefTemplatesPage /> }],
          },
          {
            // ADR-0051 d.3: the taxonomy is organisation configuration, behind the same grant
            // that edits roles, offices and brief templates.
            element: <RequirePermission perms={['admin.organization:view']} />,
            children: [{ path: '/admin/deliverable-types', element: <DeliverableTypesPage /> }],
          },
          {
            // ADR-0052: a workflow template is organisation configuration in the same sense the
            // taxonomy is, so it sits behind the same grant. I19.12 — the screen ADR-0052 named in
            // its tracker paragraph and that never became a task until now.
            element: <RequirePermission perms={['admin.organization:view']} />,
            children: [{ path: '/admin/workflow-templates', element: <WorkflowTemplatesPage /> }],
          },
          {
            element: <RequirePermission perms={['admin.organization:view']} />,
            children: [{ path: '/admin/organization', element: <OrganizationPage /> }],
          },
          {
            element: <RequirePermission perms={['audit:view']} />,
            children: [{ path: '/admin/audit', element: <AuditPage /> }],
          },
          {
            element: <RequirePermission perms={['admin.feedback:view']} />,
            children: [{ path: '/admin/feedback', element: <FeedbackAdminPage /> }],
          },
          {
            element: <RequirePermission perms={['leave:view']} />,
            children: [{ path: '/people/leave', element: <LeavePage /> }],
          },
          {
            element: <RequirePermission perms={['directory:view']} />,
            children: [{ path: '/people/directory', element: <DirectoryPage /> }],
          },
          {
            element: <RequirePermission perms={['portal:view']} />,
            children: [
              { path: '/portal', element: <RoleLanding homeKey="home.portal" testId="surface-portal" /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
