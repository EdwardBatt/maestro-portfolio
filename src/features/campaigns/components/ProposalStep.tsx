import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { InfoTip } from '../../../components/InfoTip'

/**
 * **The work** — step 3 of the campaign wizard, where the brief's proposal lands (Figma
 * `CB-v3-02b` merged into `CB-v3-03`, `I56.4`, ADR-0101; Edward, 24 Sep: *"2b should be step 3 the
 * work and the button should read Keep these - go to timing"*).
 *
 * One screen for one job. The proposal arrives in named workstreams, each with a department and an
 * owner picker; a piece the brief suggested carries a tick (kept or dropped), the line of the brief
 * it came from and a PROPOSED tag. A piece the person added themselves is plain work: a bullet and
 * a remove. Nothing is dropped for good until the person moves on — a dropped row stays, greyed,
 * one tick from coming back.
 *
 * Every row still says what stands between it and the next step ("needs an owner", "choose a
 * deliverable"), and each group keeps the quick line to type pieces into, Enter for the next.
 *
 * Presentational (AGENTS.md §4): the groups and rows come in already shaped; every press goes out.
 */
export interface ProposalGroup {
  id: string
  name: string
  departmentId: string | null
  ownerUserId: string | null
  /** True for a group the brief suggested; false for one the person added. */
  proposed: boolean
  /** Owner choices for THIS group, already in the order to show them. */
  ownerChoices: { id: string; name: string; hint: string | null }[]
}

export interface ProposalRow {
  id: string
  groupId: string | null
  name: string
  /** "from "make the mechanic obvious" · Week 1 · ×3" — composed by the caller. */
  meta: string
  /** The brief suggested it; it carries a keep/drop tick rather than a remove. */
  proposed: boolean
  kept: boolean
  /** The one thing standing between this piece and the next step, said on the row. */
  warn: string | null
}

export function ProposalStep({
  groups,
  rows,
  departments,
  status,
  onToggleRow,
  onKeepAll,
  onDropAll,
  onEditRow,
  onAddToGroup,
  onQuickAdd,
  onMoveRow = null,
  onRemoveRow,
  onNewWorkstream,
  onOpenGroup = null,
  onRenameGroup,
  onSetDepartment,
  onSetOwner,
  grouping = true,
  ungroupedAllowed = true,
  testId = 'proposal',
}: {
  groups: ProposalGroup[]
  rows: ProposalRow[]
  departments: { id: string; name: string }[]
  /** A sentence about the proposal when there is something to say — none proposed, or untyped. */
  status?: string | null
  onToggleRow: (rowId: string) => void
  onKeepAll: (groupId: string | null) => void
  onDropAll: (groupId: string | null) => void
  onEditRow: (rowId: string) => void
  onAddToGroup: (groupId: string | null) => void
  /** The quick line: a piece named and nothing else, straight into this group. */
  onQuickAdd: (groupId: string | null, name: string) => void
  onMoveRow?: ((rowId: string) => void) | null
  /** A piece the person added themselves is removed, not dropped. */
  onRemoveRow: (rowId: string) => void
  onNewWorkstream: () => void
  /** Open one workstream in the drawer down the right (CB-v3-P5): its state strip, its pieces by phase. */
  onOpenGroup?: ((groupId: string) => void) | null
  onRenameGroup: (groupId: string, name: string) => void
  onSetDepartment: (groupId: string, departmentId: string) => void
  onSetOwner: (groupId: string, ownerUserId: string | null) => void
  /**
   * ADR-0101 d.9: false when the campaign does not use workstreams. The work is one plain list —
   * no group headers, no department or owner pickers, no + New workstream, no Move.
   */
  grouping?: boolean
  /** ADR-0116 d.3: false on a campaign — a piece may not stay out of every workstream. */
  ungroupedAllowed?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const ungrouped = rows.filter((r) => r.groupId == null)
  const proposedRows = rows.filter((r) => r.proposed)
  const anyProposed = proposedRows.length > 0
  const kept = proposedRows.filter((r) => r.kept).length
  const dropped = proposedRows.length - kept

  // Work in no group answers to the same key the wizard uses for it.
  const key = (groupId: string | null) => groupId ?? '__ungrouped__'
  const commit = (groupId: string | null) => {
    const name = (drafts[key(groupId)] ?? '').trim()
    if (!name) return
    onQuickAdd(groupId, name)
    setDrafts((d) => ({ ...d, [key(groupId)]: '' }))
    // Enter adds the next line: the caret stays where it is, ready for the next piece.
    inputs.current[key(groupId)]?.focus()
  }

  const renderRows = (list: ProposalRow[], groupId: string | null, canAdd = true) => (
    <>
      {list.length > 0 && (
        <ul className="proposal-rows">
          {list.map((r) => (
            <li
              key={r.id}
              className={`proposal-row${r.proposed && !r.kept ? ' is-dropped' : ''}`}
              data-testid={`${testId}-piece-${r.id}`}
            >
              {r.proposed ? (
                <label className="proposal-row-keep">
                  <input
                    type="checkbox"
                    checked={r.kept}
                    onChange={() => onToggleRow(r.id)}
                    aria-label={t(r.kept ? 'proposal.dropRow' : 'proposal.keepRow', { name: r.name })}
                    data-testid={`${testId}-keep-${r.id}`}
                  />
                  <span className="proposal-row-name">{r.name}</span>
                </label>
              ) : (
                <span className="proposal-row-keep">
                  <span className="proposal-row-dot" aria-hidden="true" />
                  <span className="proposal-row-name">{r.name}</span>
                </span>
              )}
              {r.meta && <span className="proposal-row-meta" dir="auto">{r.meta}</span>}
              {r.proposed && <span className="proposal-chip" data-testid={`${testId}-proposed-${r.id}`}>{t('proposal.proposed')}</span>}
              {r.warn && (!r.proposed || r.kept) && (
                <span className="proposal-warn" data-testid={`${testId}-warn-${r.id}`}>{r.warn}</span>
              )}
              <button type="button" className="proposal-row-edit" onClick={() => onEditRow(r.id)} data-testid={`${testId}-edit-${r.id}`}>
                {t('proposal.edit')}
              </button>
              {onMoveRow && (
                <button type="button" className="proposal-row-edit" onClick={() => onMoveRow(r.id)} data-testid={`${testId}-move-${r.id}`}>
                  {t('proposal.move')}
                </button>
              )}
              {!r.proposed && (
                <IconButton
                  icon="close"
                  size="sm"
                  label={t('proposal.remove', { name: r.name })}
                  onClick={() => onRemoveRow(r.id)}
                  data-testid={`${testId}-remove-${r.id}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && <input
        ref={(el) => {
          inputs.current[key(groupId)] = el
        }}
        className="proposal-quick"
        value={drafts[key(groupId)] ?? ''}
        placeholder={t('proposal.quickAdd')}
        onChange={(e) => setDrafts((d) => ({ ...d, [key(groupId)]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(groupId)
          }
        }}
        onBlur={() => commit(groupId)}
        aria-label={t('proposal.quickAdd')}
        data-testid={`${testId}-new-${key(groupId)}`}
      />}
    </>
  )

  const groupActions = (groupId: string | null, hasProposed: boolean, canAdd = true) => (
    <span className="proposal-group-actions">
      {hasProposed && (
        <>
          <button type="button" className="proposal-link" onClick={() => onKeepAll(groupId)} data-testid={`${testId}-keep-all-${key(groupId)}`}>
            {t('proposal.keepAll')}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="proposal-link" onClick={() => onDropAll(groupId)} data-testid={`${testId}-drop-all-${key(groupId)}`}>
            {t('proposal.dropAll')}
          </button>
        </>
      )}
      {canAdd && (
        <Button variant="secondary" size="sm" icon="plus" onClick={() => onAddToGroup(groupId)} data-testid={`${testId}-add-piece-${key(groupId)}`}>
          {t('proposal.add')}
        </Button>
      )}
    </span>
  )

  return (
    <div className="proposal-step" data-testid={testId}>
      <h2 className="brief-step-title">{t(anyProposed ? 'proposal.title' : 'proposal.workTitle')}</h2>
      <p className="brief-step-lede">{t(anyProposed ? 'proposal.lede' : 'proposal.workLede')}</p>

      {status && (
        <p className="proposal-status" role="status" data-testid={`${testId}-status`}>{status}</p>
      )}

      {grouping && groups.map((g) => {
        const list = rows.filter((r) => r.groupId === g.id)
        return (
          <section key={g.id} className="proposal-group" data-testid={`${testId}-group-${g.id}`}>
            <header className="proposal-group-head">
              <span className="proposal-group-bar" aria-hidden="true" />
              <input
                className="proposal-group-name"
                value={g.name}
                onChange={(e) => onRenameGroup(g.id, e.target.value)}
                aria-label={t('proposal.groupName')}
                data-testid={`${testId}-group-name-${g.id}`}
              />
              <select
                className={`proposal-chip-select${g.departmentId ? '' : ' is-missing'}`}
                value={g.departmentId ?? ''}
                onChange={(e) => onSetDepartment(g.id, e.target.value)}
                aria-label={t('proposal.department')}
                data-testid={`${testId}-dept-${g.id}`}
              >
                <option value="" disabled>{t('proposal.noDepartment')}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {g.proposed && <span className="proposal-chip">{t('proposal.proposed')}</span>}
              <select
                className="proposal-chip-select is-owner"
                value={g.ownerUserId ?? ''}
                onChange={(e) => onSetOwner(g.id, e.target.value || null)}
                aria-label={t('proposal.owner')}
                data-testid={`${testId}-owner-${g.id}`}
              >
                <option value="">{t('proposal.noOwner')}</option>
                {g.ownerChoices.map((p) => (
                  <option key={p.id} value={p.id}>{p.hint ? `${p.name} · ${p.hint}` : p.name}</option>
                ))}
              </select>
              <InfoTip label={t('proposal.owner')} lines={[t('proposal.ownerTip')]} testId={`${testId}-owner-tip-${g.id}`} />
              <span className="proposal-gap" />
              {onOpenGroup && (
                <button type="button" className="proposal-link" onClick={() => onOpenGroup(g.id)} data-testid={`${testId}-open-${g.id}`}>
                  {t('proposal.open')}
                </button>
              )}
              {groupActions(g.id, list.some((r) => r.proposed))}
            </header>
            {renderRows(list, g.id)}
          </section>
        )
      })}

      {/* Work in no workstream. Where grouping is optional (ADR-0099 d.1) it is somewhere to type; on a
          campaign (ADR-0116 d.3) it holds only a piece still to be moved into one — nothing is added
          here, and the section goes as soon as it is empty. */}
      {(ungroupedAllowed ? (ungrouped.length > 0 || groups.length === 0 || !grouping) : ungrouped.length > 0) && (
        <section className={`proposal-group is-ungrouped${ungroupedAllowed ? '' : ' needs-workstream'}`} data-testid={`${testId}-group-__ungrouped__`}>
          <header className="proposal-group-head">
            <span className="proposal-group-bar" aria-hidden="true" />
            <span className="proposal-group-title">
              {t(!ungroupedAllowed ? 'proposal.needsWorkstream' : grouping ? 'proposal.ungrouped' : 'proposal.allPieces')}
            </span>
            <span className="proposal-gap" />
            {groupActions(null, ungrouped.some((r) => r.proposed), ungroupedAllowed)}
          </header>
          {renderRows(ungrouped, null, ungroupedAllowed)}
        </section>
      )}

      {grouping && (
        <button type="button" className="proposal-new" onClick={onNewWorkstream} data-testid={`${testId}-new-group`}>
          <span className="proposal-new-add">{t('proposal.newWorkstream')}</span>
          <span className="proposal-new-hint">{t('proposal.newWorkstreamHint')}</span>
        </button>
      )}

      {anyProposed && (
        <p className="proposal-summary" data-testid={`${testId}-summary`}>
          {t('proposal.summary', { kept, dropped, count: kept })}
        </p>
      )}
    </div>
  )
}
