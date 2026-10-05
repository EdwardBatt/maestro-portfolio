import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'

/**
 * The one button (I48.32).
 *
 * Before this, every page picked a class by hand and `index.css` carried five competing
 * "primary" rules; fourteen buttons named classes that had no CSS at all and rendered as the
 * browser's grey default. Four variants say what a button IS, and the look follows:
 *
 * - `primary`   — the one thing to do on this screen: Save, Approve, Submit, Promote.
 * - `secondary` — the alternative beside it: Cancel, Close, Back, Edit.
 * - `danger`    — Delete, Archive, Withdraw, and their confirm step. Text form; for a row,
 *                 prefer `IconButton` (Edward: an icon wherever one will do).
 * - `link`      — NAVIGATION and view toggles only: open a row, show all, clear a filter, the
 *                 name of a thing. Never for something that writes — Edward (14 Sep): an Actions
 *                 column of blue words is what this component exists to replace.
 * - `arrow`     — the Figma's "C · Arrow" (section I, I59): a primary that points where it goes, a
 *                 ▶ after the label that nudges on hover and further on press. The one main action
 *                 on a Needs-you card. It mirrors in Arabic.
 *
 * `tone` colours a button by the ACTION it takes, never by who is looking (E17, I59 — Edward,
 * 26 Sep: "green for approval, brown for change requests… roles remain as is with violet"):
 *
 * - `approve` — green, filled: Approve, Sign off, Approve the task list or the campaign, Approve an
 *               extension or a booking request (Figma D3 "Approve it"). On `primary` / `arrow`.
 * - `change`  — brown, filled: send a change request, accept one, accept her version (CG-E2,
 *               NY-AM-5 "Accept and reply"). On `primary` / `arrow`.
 * - `caution` — rust outline: Request changes, Escalate, I'm blocked, Decline, Refuse (D3, NY-AM-5,
 *               M2). On `secondary` (or `danger`, which it recolours to the calmer rust).
 *
 * No tone is the violet system primary — every other main action.
 *
 * `busy` puts a spinner in the button, marks it `aria-busy` and blocks further presses — one
 * affordance, so "is anything happening?" has the same answer everywhere (formerly
 * `BusyButton`). `to` renders the same look as a router `<Link>`, for a button that navigates.
 *
 * Presentation only (AGENTS.md §4): it takes booleans and a variant, it knows nothing of
 * mutations or permissions.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link' | 'arrow'
export type ButtonSize = 'md' | 'sm'
export type ButtonTone = 'approve' | 'change' | 'caution'

type Common = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** An icon before the label. */
  icon?: IconName
  /** What the action does, when it is one of the coloured ones (E17). */
  tone?: ButtonTone
}

// `ComponentProps<'button'>` rather than `ButtonHTMLAttributes` so a `ref` passes through — React
// 19 hands it over as an ordinary prop, and the dialogs focus their Cancel on open.
type AsButton = Common & React.ComponentProps<'button'> & { busy?: boolean; to?: undefined }

type AsLink = Common &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; busy?: undefined }

export type ButtonProps = AsButton | AsLink

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string,
  busy = false,
  tone?: ButtonTone,
) {
  return ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', tone ? `btn-tone-${tone}` : '', busy ? 'is-busy' : '', extra]
    .filter(Boolean)
    .join(' ')
}

export function Button(props: ButtonProps) {
  const { t } = useTranslation()
  if (props.to !== undefined) {
    const { variant, size, icon, tone, to, className, children, ...rest } = props
    return (
      <Link {...rest} to={to} className={buttonClass(variant, size, className, false, tone)}>
        {icon && <Icon name={icon} />}
        {children}
        {variant === 'arrow' && <ArrowMark />}
      </Link>
    )
  }
  const { variant, size, icon, tone, busy = false, disabled = false, className, children, type, ...rest } = props
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={buttonClass(variant, size, className, busy, tone)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner label={t('common.working')} /> : icon && <Icon name={icon} />}
      {children}
      {variant === 'arrow' && <ArrowMark />}
    </button>
  )
}

/** The arrow variant's ▶ — drawn in CSS so it takes the label's colour and mirrors under RTL. */
function ArrowMark() {
  return <span className="btn-arrow-mark" aria-hidden="true" />
}

/**
 * An icon-only button for the actions a row or a card repeats — delete, remove, close, move up,
 * move down. The `label` is required: it is the accessible name AND the tooltip, so the icon
 * is never the only explanation. `danger` colours it red on hover, not at rest — a row of red
 * bins is noise (calm is the default; attention is earned).
 */
export function IconButton({
  icon,
  label,
  danger = false,
  size = 'md',
  busy = false,
  disabled = false,
  className,
  type,
  title,
  ...rest
}: React.ComponentProps<'button'> & {
  icon: IconName
  label: string
  danger?: boolean
  size?: ButtonSize
  busy?: boolean
}) {
  const { t } = useTranslation()
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={['icon-btn', danger ? 'is-danger' : '', size === 'sm' ? 'icon-btn-sm' : '', busy ? 'is-busy' : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner label={t('common.working')} /> : <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
    </button>
  )
}

/**
 * A delete that asks once. At rest it is the bin icon (quiet, red only on hover); the first press
 * ARMS it and it becomes a small red text button carrying the confirm wording; the second press
 * is the deletion. It is ONE element in both states — not an icon swapped for a button — so
 * keyboard focus survives the arming press and Enter, Enter deletes; a swapped element would
 * drop focus on the floor between the two. The arming state belongs to the caller — it already
 * lives there on every page that has one.
 */
export function DeleteButton({
  armed,
  label,
  confirm,
  icon = 'trash',
  size = 'md',
  className,
  type,
  ...rest
}: Omit<React.ComponentProps<'button'>, 'children'> & {
  armed: boolean
  /** The action at rest — "Delete", "Remove", "Discard". */
  label: string
  /** The wording once armed — "Really delete?", "Confirm". */
  confirm: string
  icon?: IconName
  size?: ButtonSize
}) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={armed
        ? buttonClass('danger', 'sm', className)
        : ['icon-btn', 'is-danger', size === 'sm' ? 'icon-btn-sm' : '', className].filter(Boolean).join(' ')}
      aria-label={armed ? undefined : label}
      title={armed ? undefined : label}
      data-armed={armed || undefined}
    >
      {armed ? confirm : <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
    </button>
  )
}

/**
 * The spinner on its own, for places with no button to put it in — a drag that saves on drop, a
 * panel refreshing behind the scenes.
 */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label} data-testid="spinner">
      <span className="spinner-dot" aria-hidden="true" />
    </span>
  )
}

/** An inline "working…" line for background actions that have no button of their own. */
export function BusyNote({ text }: { text: string }) {
  return (
    <p className="busy-note" role="status" data-testid="busy-note">
      <Spinner />
      {text}
    </p>
  )
}
