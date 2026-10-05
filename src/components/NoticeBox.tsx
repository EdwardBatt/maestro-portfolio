/**
 * Instruction and advice, in a bordered box rather than a muted paragraph.
 *
 * Edward, 5 Sep 2026: *"these are instructions for the users… they appear not to read the text if
 * it is not highlighted."* That is the whole reason this exists. Guidance that sits as grey body
 * copy under a control gets skimmed past, and then the thing it warned about happens anyway.
 *
 * NOT `NoticeDialog`. That interrupts to report something that already happened; this is standing
 * guidance about the control beside it and never blocks. Both are called "notice" because they
 * carry the same voice, not because they behave alike.
 *
 * ONE TONE, DELIBERATELY. `warn` is the default and, on the brief wizard, the only one used. Edward
 * was offered a two-tier scheme — amber where getting it wrong has a consequence, a calmer blue for
 * ordinary guidance — and chose to keep everything amber for now. The `kind` prop exists so that
 * decision can be revisited per-instance without touching every caller.
 *
 * **SUPERSEDED FOR STANDING ADVICE (Edward, 24 Sep):** *"amber notes should always be displayed as
 * information pop-ups. this reduces clutter on screen."* Advice about a control is an (i) beside its
 * heading (`InfoTip`). This box is now only for something that just happened or a state the page is
 * in — the model proposed nothing, the job is already released — which must be seen, not hovered.
 *
 * Presentation only (AGENTS.md §4): strings in, box out. It decides nothing.
 */
export type NoticeBoxKind = 'warn' | 'breach' | 'info'

export function NoticeBox({
  lines,
  kind = 'warn',
  role,
  testId,
}: {
  /**
   * One paragraph per entry. Falsy entries are dropped so a caller can pass a conditional
   * second line without composing the array itself.
   */
  lines: readonly (string | false | null | undefined)[]
  kind?: NoticeBoxKind
  /**
   * `status` where the box appears in response to something the user just did — the model returning
   * nothing, dates being filled in. A screen reader must hear those; standing guidance it already
   * read on the way past is not announced again.
   */
  role?: 'status'
  testId?: string
}) {
  const shown = lines.filter((l): l is string => Boolean(l))
  if (shown.length === 0) return null

  return (
    <div className={`notice notice-box notice-${kind}`} role={role} data-testid={testId}>
      {shown.map((line, i) => (
        <p key={i} data-testid={testId ? `${testId}-line-${i}` : undefined}>
          {line}
        </p>
      ))}
    </div>
  )
}
