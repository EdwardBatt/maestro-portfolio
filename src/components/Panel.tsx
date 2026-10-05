import type { ReactNode } from 'react'
import { Tag, type TagTone } from './Tag'

/**
 * A titled card — the bordered white panel the CS-Flows two-column forms are built from
 * ("Who it is for", "The job", "The brief", "What only you know"). A header with a title and an
 * optional caption tag on the inline-end, then a body of fields.
 *
 * Presentation only. Kept separate from `stat-card`/`.card` because those are dashboard tiles; this
 * is a form container with a labelled header and consistent field spacing inside.
 */
export function Panel({
  title,
  tag,
  tagTone = 'neutral',
  headerEnd,
  children,
  testId,
}: {
  title: ReactNode
  /** The small caption on the header's inline-end, e.g. "AND WHEN THEY ASKED", "WHAT WE ARE MAKING". */
  tag?: ReactNode
  tagTone?: TagTone
  /** An alternative header-end slot for something richer than a tag (a count, a control). */
  headerEnd?: ReactNode
  children: ReactNode
  testId?: string
}) {
  return (
    <section className="panel" data-testid={testId}>
      <header className="panel-head">
        <h3 className="panel-title">{title}</h3>
        {headerEnd ?? (tag ? <Tag tone={tagTone}>{tag}</Tag> : null)}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
