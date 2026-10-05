import { useTranslation } from 'react-i18next'

/**
 * "9 tasks" — the list a proposed deliverable will produce, folded under its row (Edward, 22 Sep:
 * *"how can the task list be approved if it cannot be reviewed?"*). A native `<details>`: opened
 * with the keyboard, found by find-in-page, no state for the wizard to carry. Read-only — the
 * real list is edited on the department's tab once the campaign is approved.
 *
 * `tasks` null: the row has no catalogue entry yet, so there is nothing to preview and nothing is
 * shown. Empty: the entry has no workflow template — said, because a deliverable with no task
 * list is a thing the account manager should know before approving.
 */
export function TaskPreview({ tasks, testId }: { tasks: string[] | null; testId: string }) {
  const { t } = useTranslation()
  if (tasks === null) return null
  if (tasks.length === 0) {
    return <span className="muted deliverable-note" data-testid={`${testId}-none`}>{t('campaigns.wizard.taskPreviewNone')}</span>
  }
  return (
    <details className="task-preview" data-testid={testId}>
      <summary className="task-preview-summary" data-testid={`${testId}-toggle`}>
        {t('campaigns.wizard.taskPreview', { count: tasks.length })}
      </summary>
      <p className="muted task-preview-intro">{t('campaigns.wizard.taskPreviewIntro')}</p>
      <ol className="task-preview-list" data-testid={`${testId}-list`}>
        {tasks.map((title, i) => <li key={i}>{title}</li>)}
      </ol>
    </details>
  )
}
