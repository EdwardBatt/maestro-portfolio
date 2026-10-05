import type { ExtensionArithmetic } from '../../../lib/deadlines/extension-arithmetic'

/**
 * The sentence an extension's arithmetic reads as (ADR-0088 d.7, in ADR-0075 d.9's shape): not
 * "this is too tight" but the numbers — days left, days needed — and which of fine / tight / at risk
 * that makes. One function, so the ask dialog and the approver's decision line say the same thing.
 */
export function arithmeticText(
  a: ExtensionArithmetic,
  hasDeliverableDue: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (a.severity === 'after_go_live') return t('deadlineExtension.arithmetic_after_go_live')
  if (!hasDeliverableDue) return t('deadlineExtension.arithmetic_none')
  // I48.25: past the deliverable's own due date the count is negative — said as "past", with the
  // approval it needs, rather than as a minus sign a maker cannot act on.
  if ((a.workingDaysLeft ?? 0) < 0) return t('deadlineExtension.arithmetic_past_due', { days: -(a.workingDaysLeft ?? 0) })
  return t(`deadlineExtension.arithmetic_${a.severity}`, { days: a.workingDaysLeft ?? 0, buffer: a.bufferDays })
}
