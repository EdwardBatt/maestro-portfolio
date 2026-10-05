import { useContext, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../../../../components/Modal'
import { RequestEyebrowContext } from './request-eyebrow'

/**
 * The shell every Needs-you and task-page dialog shares (plan View 6, I59 Track 6): a title, the
 * body, the server's sentence when it refused, and — always last — the **Who is told** line naming
 * the people the notification and email go to. Presentation only; the caller owns the mutation.
 *
 * The legacy `.dialog` card inside `Modal card={false}`, as the extension dialog is, so the fields
 * read like every other dialog on the task and Escape / backdrop close it.
 *
 * Laid out as the NY-* frames draw it (26 Sep): the head (eyebrow, title, subtitle), the body, and a
 * quiet foot band carrying the actions — the main one first — with the Who-is-told line as its note.
 */
export function RequestDialog({
  testId,
  title,
  subtitle,
  told,
  error,
  actions,
  onClose,
  children,
}: {
  testId: string
  title: string
  subtitle?: string | null
  /** Who gets the notification and email — already joined ("Fadia and Inas"), or null when nobody. */
  told: string | null
  error?: string | null
  actions: ReactNode
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const eyebrow = useContext(RequestEyebrowContext)
  return (
    <Modal onClose={onClose} card={false}>
      <div className="dialog rq-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={`${testId}-dialog`}>
        <header className="rq-head">
          {eyebrow && (
            <span className={`rq-eyebrow rq-eyebrow-${eyebrow.tone}`} data-testid={`${testId}-eyebrow`}>{eyebrow.text}</span>
          )}
          <h2>{title}</h2>
          {subtitle && <p className="muted" dir="auto">{subtitle}</p>}
        </header>
        <div className="rq-body">
          {children}
          {error && (
            <p className="form-error" role="alert" data-testid={`${testId}-error`}>{error}</p>
          )}
        </div>
        <footer className="rq-foot">
          <div className="dialog-actions">{actions}</div>
          <p className="rq-told" data-testid={`${testId}-told`}>
            {told ? t('requests.told', { names: told }) : t('requests.toldNobody')}
          </p>
        </footer>
      </div>
    </Modal>
  )
}
