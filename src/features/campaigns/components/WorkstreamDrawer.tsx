import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'

/**
 * One workstream, opened from its row (Figma `CB-v3-P5`, `I56.3`).
 *
 * A **drawer down the right**, not a dialog in the middle — because the list behind it stays
 * readable, and the point of opening a workstream is to compare what is in it against everything
 * else on the screen. A centred modal would hide exactly what you opened it to check.
 *
 * Two things the frame does that a plain list would not:
 *
 *  - **a state strip across the top** — Delivered, In progress, In review, Not started, and
 *    *Kurdish pending*. The last one is not a status, it is a language waiting for its own piece
 *    (`I56.7`), and it sits in the strip because "what is outstanding" is the question this drawer
 *    is opened to answer;
 *  - **pieces grouped by phase**, under a small phase heading. The campaign runs on phases, so a
 *    flat list of twenty-one pieces would lose the only ordering anybody thinks in.
 *
 * The footer carries the two acts that belong to the group rather than a piece — add one, and
 * rename the group. Not "move department" (`I57.27`): since ADR-0102 d.2 a group's department
 * moves none of its work, so the frame's second verb is dropped.
 *
 * Presentational: props in, callbacks out.
 */
export interface DrawerPiece {
  id: string
  name: string
  /** The format line under the name — "Carousel", "Static", "Animation". */
  detail: string | null
  /** The work's own state, as the frame chips it. */
  state: 'delivered' | 'in_progress' | 'in_review' | 'not_started'
  /** The second chip: whether the client has signed this off. */
  clientApproved: boolean | null
  phaseName: string | null
}

export function WorkstreamDrawer({
  name,
  departmentName,
  ownerName,
  managerName,
  pieces,
  /** Pieces waiting on a language of their own (I56.7). Counted, never inferred here. */
  languagePending,
  languagePendingLabel,
  onAddPiece,
  onEditPiece,
  onRemovePiece,
  onRename,
  onClose,
  testId = 'workstream-drawer',
}: {
  name: string
  departmentName: string
  ownerName: string | null
  managerName: string | null
  pieces: DrawerPiece[]
  languagePending?: number
  languagePendingLabel?: string
  onAddPiece: () => void
  onEditPiece: (id: string) => void
  onRemovePiece: (id: string) => void
  onRename: () => void
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()

  const count = (s: DrawerPiece['state']) => pieces.filter((p) => p.state === s).length
  const delivered = count('delivered')

  // Phases in the order the pieces arrive — the caller has already sorted them, and re-sorting
  // here would silently disagree with the step behind the drawer.
  const phases: (string | null)[] = []
  for (const p of pieces) if (!phases.includes(p.phaseName)) phases.push(p.phaseName)

  return (
    <Modal onClose={onClose} testId={`${testId}-modal`} labelledById={`${testId}-title`} card={false}>
      <aside className="ws-drawer" data-testid={testId}>
        <div className="ws-drawer-body">
          <div className="ws-drawer-chips">
            <span className="ws-chip-plain">{t('workstreamDrawer.eyebrow')}</span>
            <span className="workgroup-chip">
              {t('work.groupChip', {
                department: departmentName.toUpperCase(),
                owner: (ownerName ?? t('work.nobody')).toUpperCase(),
              })}
            </span>
          </div>

          <h2 id={`${testId}-title`} className="ws-drawer-title">{name}</h2>
          <p className="ws-drawer-sub" data-testid={`${testId}-sub`}>
            {t('workstreamDrawer.sub', {
              pieces: pieces.length,
              count: pieces.length,
              delivered,
              manager: managerName ?? t('work.nobody'),
            })}
          </p>

          {/* The strip. Zero is printed, not hidden — "Not started 0" is the reassuring one. */}
          <div className="ws-drawer-stats" data-testid={`${testId}-stats`}>
            <Stat label={t('workstreamDrawer.delivered')} value={delivered} tone="ok" testId={`${testId}-stat-delivered`} />
            <Stat label={t('workstreamDrawer.inProgress')} value={count('in_progress')} testId={`${testId}-stat-in-progress`} />
            <Stat label={t('workstreamDrawer.inReview')} value={count('in_review')} tone="warn" testId={`${testId}-stat-in-review`} />
            <Stat label={t('workstreamDrawer.notStarted')} value={count('not_started')} testId={`${testId}-stat-not-started`} />
            {languagePending != null && languagePending > 0 && (
              <Stat
                label={languagePendingLabel ?? t('workstreamDrawer.languagePending')}
                value={languagePending}
                tone="warn"
                testId={`${testId}-stat-language`}
              />
            )}
          </div>

          {phases.map((phase) => (
            <div key={phase ?? '__none__'} className="ws-drawer-phase">
              <p className="ws-drawer-phase-name">
                {(phase ?? t('workstreamDrawer.noPhase')).toUpperCase()}
              </p>
              {pieces
                .filter((p) => p.phaseName === phase)
                .map((p) => (
                  <div className="ws-drawer-row" key={p.id} data-testid={`${testId}-piece-${p.id}`}>
                    <span className="ws-drawer-row-main">
                      <span className="ws-drawer-row-name">{p.name}</span>
                      {p.detail && <span className="ws-drawer-row-detail">{p.detail}</span>}
                    </span>
                    <span className={`ws-state ws-state-${p.state}`} data-testid={`${testId}-state-${p.id}`}>
                      {t(`workstreamDrawer.state.${p.state}`)}
                    </span>
                    {p.clientApproved != null && (
                      <span
                        className={`ws-approved${p.clientApproved ? ' yes' : ''}`}
                        data-testid={`${testId}-approved-${p.id}`}
                      >
                        {p.clientApproved ? t('workstreamDrawer.yes') : t('workstreamDrawer.pending')}
                      </span>
                    )}
                    <button
                      type="button"
                      className="workpiece-edit"
                      onClick={() => onEditPiece(p.id)}
                      data-testid={`${testId}-edit-${p.id}`}
                    >
                      {t('work.edit')}
                    </button>
                    <button
                      type="button"
                      className="ws-drawer-remove"
                      onClick={() => onRemovePiece(p.id)}
                      data-testid={`${testId}-remove-${p.id}`}
                    >
                      {t('workstreamDrawer.remove')}
                    </button>
                  </div>
                ))}
            </div>
          ))}

          {pieces.length === 0 && (
            <p className="muted" data-testid={`${testId}-empty`}>{t('workstreamDrawer.empty')}</p>
          )}
        </div>

        <footer className="ws-drawer-foot">
          <Button variant="primary" onClick={onAddPiece} data-testid={`${testId}-add`}>
            {t('workstreamDrawer.addPiece')}
          </Button>
          <Button variant="secondary" onClick={onRename} data-testid={`${testId}-rename`}>
            {t('workstreamDrawer.rename')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-close`}>
            {t('workstreamDrawer.close')}
          </Button>
        </footer>
      </aside>
    </Modal>
  )
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string
  value: number
  tone?: 'ok' | 'warn'
  testId: string
}) {
  return (
    <span className="ws-stat" data-testid={testId}>
      <span className="ws-stat-label">{label}</span>
      <span className={`ws-stat-value${tone ? ` ws-stat-${tone}` : ''}`}>{value}</span>
    </span>
  )
}
