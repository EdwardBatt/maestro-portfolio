/**
 * How a notification names its subject (I30.7).
 *
 * Edward, 8 Sep: "the task title should include the Project/Campaign Title… any reference to a
 * deliverable should always also include the Project/Campaign title." The campaign is resolved into
 * `notifications.context_label` by `app.tg_notification_context` on insert; this is the one place
 * the two halves are joined.
 *
 * ONE function because there are two readers — the in-app inbox and the email Edge Function — and a
 * hand-written second copy of a rule is the failure this project keeps repeating (traps.md: the
 * notification copy map, the audit trigger list, the audit entity filter). They must read
 * identically: the same event arriving twice, worded two ways, is the defect `I12.9` was raised for.
 */

/** `Campaign — Work`, or just the work when there is no campaign. */
export function notificationLabel(label: string | null, contextLabel: string | null): string | null {
  // Ad-hoc work has no campaign and gets no invented prefix (d.2); a campaign notification is not
  // prefixed with itself (d.1); `resource_clash` labels a person or a thing, which is not in a
  // campaign at all (d.3). All three arrive here as a null context.
  if (!contextLabel) return label
  if (!label) return contextLabel
  return `${contextLabel} — ${label}`
}
