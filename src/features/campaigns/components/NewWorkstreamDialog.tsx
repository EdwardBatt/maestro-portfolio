import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { isValidCodeLetters, normaliseCodeLetters, suggestCodeLetters } from '../../../lib/campaigns/code-letters'

/**
 * Make a workstream (Figma `CB-v3-P3`, ADR-0099 d.1/d.3/d.7, `I56.3`).
 *
 * Two fields, and the frame is emphatic that two is all it takes:
 *
 *   *"A name and the department it goes to. That is all a workstream needs. The pieces come next,
 *    as a list under it."*
 *
 * So there is no owner field here, although a workstream carries an owner (d.5). Naming somebody
 * to answer for a group is a decision worth making with the group in front of you, not a hurdle
 * between having the idea and writing it down — it is set afterwards, from the group's own row.
 *
 * **The department is pills, not a dropdown.** An agency has four or five, they are chosen every
 * time a group is made, and the frame shows them all at once because the choice is the point:
 * it is what the pieces underneath will inherit (d.3).
 *
 * **Code letters** (`I59.54`, Edward 27 Sep): beside the name, filled from it by the rule and following
 * it until the person types their own. They are fixed once the workstream is made, so the box is
 * offered here and nowhere else — a rename shows none.
 *
 * **Rename** is the same dialog with the name only (`I57.27`, Edward 25 Sep). A workstream keeps its
 * department once made: since ADR-0102 d.2 moving a group between departments would move nothing
 * but its label, so the drawer offers the name and no more.
 */
export function NewWorkstreamDialog({
  departments,
  /** Names already used on this campaign — d.7 is case-insensitive, so the check is too. */
  takenNames,
  onCreate,
  renaming,
  onCancel,
  busy = false,
  testId = 'new-workstream',
}: {
  departments: { id: string; name: string }[]
  takenNames: string[]
  /** I59.54: `codeLetters` is what the person typed; absent, the database uses the rule's. */
  onCreate: (name: string, departmentId: string, codeLetters?: string) => void
  /** Rename mode: the group's current name, and where the new one goes. No department is asked. */
  renaming?: { name: string; onRename: (name: string) => void }
  onCancel: () => void
  busy?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(renaming?.name ?? '')
  const [departmentId, setDepartmentId] = useState<string>('')
  // Null while the box follows the name; the person's own letters once they type.
  const [typedLetters, setTypedLetters] = useState<string | null>(null)
  const letters = typedLetters ?? (name.trim() ? suggestCodeLetters(name) : '')
  const lettersBad = typedLetters !== null && !isValidCodeLetters(typedLetters)

  // d.7 caught here so the person is told while typing, rather than by a refusal after pressing.
  // The server still decides — this is a courtesy, not the rule. A rename may keep its own name.
  const own = renaming?.name.trim().toLowerCase()
  const clash = takenNames.find((n) => {
    const k = n.trim().toLowerCase()
    return k !== own && k === name.trim().toLowerCase()
  })
  const ready =
    name.trim().length > 0 && !clash && (renaming ? name.trim() !== renaming.name : departmentId !== '' && !lettersBad)

  return (
    <Modal onClose={onCancel} testId={`${testId}-dialog`} labelledById={`${testId}-title`}>
      <div className="new-workstream">
        <span className="piece-eyebrow">{t(renaming ? 'newWorkstream.renameFrom' : 'newWorkstream.from')}</span>
        <h2 id={`${testId}-title`} className="piece-title">{t(renaming ? 'newWorkstream.renameTitle' : 'newWorkstream.title')}</h2>
        <p className="piece-lede">{t(renaming ? 'newWorkstream.renameLede' : 'newWorkstream.lede')}</p>

        <div className={renaming ? undefined : 'new-workstream-name-row'}>
          <label className="field">
            <span className="field-label">
              {t('newWorkstream.name')} <span className="req-chip">{t('piece.required')}</span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid={`${testId}-name`}
            />
            {clash && (
              <span className="field-error" data-testid={`${testId}-clash`}>
                {t('newWorkstream.nameTaken', { name: clash })}
              </span>
            )}
          </label>

          {!renaming && (
            <label className="field new-workstream-letters">
              <span className="field-label">{t('newWorkstream.letters')}</span>
              <input
                value={letters}
                maxLength={4}
                dir="ltr"
                onChange={(e) => setTypedLetters(e.target.value.toUpperCase())}
                aria-invalid={lettersBad}
                data-testid={`${testId}-letters`}
              />
            </label>
          )}
        </div>
        {!renaming && (letters || lettersBad) && (
          <p className={lettersBad ? 'field-error' : 'field-hint'} data-testid={`${testId}-letters-hint`}>
            {lettersBad
              ? t('newWorkstream.lettersInvalid')
              : t('newWorkstream.lettersHint', { example: `${normaliseCodeLetters(letters)}-001` })}
          </p>
        )}

        {!renaming && (
          <div className="field">
            <span className="field-label">{t('newWorkstream.goesTo')}</span>
            <div className="workstream-depts">
              {departments.map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className={`workstream-dept${departmentId === d.id ? ' on' : ''}`}
                  aria-pressed={departmentId === d.id}
                  onClick={() => setDepartmentId(d.id)}
                  data-testid={`${testId}-dept-${d.id}`}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="piece-actions">
          <Button
            variant="primary"
            busy={busy}
            disabled={!ready}
            onClick={() => (renaming ? renaming.onRename(name.trim()) : onCreate(name.trim(), departmentId, typedLetters === null ? undefined : normaliseCodeLetters(typedLetters)))}
            data-testid={`${testId}-create`}
          >
            {t(renaming ? 'newWorkstream.rename' : 'newWorkstream.create')}
          </Button>
          <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
            {t('newWorkstream.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
