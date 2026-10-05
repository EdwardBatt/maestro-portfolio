import { useTranslation } from 'react-i18next'
import { useDeliverableRules } from '../api/review-rules-api'
import type { ClientRule } from '../../../lib/brief/rules'

/**
 * ADR-0112 d.1 (I59.29, Q26b): the rules the piece follows, beside the file on the review screen.
 *
 * Shown, never ticked — Edward, 25 Sep: *"they are rules that need to be followed"*. Plain lines, a
 * Do / Don't mark and the rule's words, as the task-list approval shows them. Nothing when the piece
 * carries no rules.
 */
export function ReviewRules({ deliverableId, testId = 'review-rules' }: { deliverableId: string; testId?: string }) {
  const { rules } = useDeliverableRules(deliverableId)
  return <ReviewRulesList rules={rules} testId={testId} />
}

/** The list itself, for a surface that already holds the rules (the task page). */
export function ReviewRulesList({ rules, testId = 'review-rules' }: { rules: readonly ClientRule[]; testId?: string }) {
  const { t } = useTranslation()
  if (rules.length === 0) return null
  return (
    <aside className="review-rules" aria-label={t('reviewPins.rules')} data-testid={testId}>
      <h4 className="review-rules-head">{t('reviewPins.rules')}</h4>
      <ul className="sj-rules">
        {rules.map((r, i) => (
          <li key={i} className="sj-rule" data-testid={`${testId}-${i}`}>
            <span className={`rule-pill rule-${r.kind} is-on`}>{t(r.kind === 'do' ? 'clients.rules.do' : 'clients.rules.dont')}</span>
            <span className="sj-rule-text" dir="auto">{r.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
