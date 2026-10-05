import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { usePermissions } from '../../../app/permissions'
import { Modal, ModalFooter, ModalHeader } from '../../../components/Modal'
import { isNewRequestShortcut, shortcutLabel } from '../lib/shortcut'
import { FULL_CAMPAIGN_ROUTE, OPEN_NEW_REQUEST_EVENT, SINGLE_JOB_ROUTE } from '../lib/new-request'
import { ChoiceCard } from './ChoiceCard'
import { Button } from '../../../components/Button'

/**
 * The one door (ADR-0082). Every piece of work enters through this modal — a single job, or a full
 * campaign — opened by `Ctrl/Cmd + P` from anywhere and by New on `/campaigns` (d.7).
 *
 * **The shortcut is claimed for EVERYONE**, and what the modal says depends on the person
 * (Edward, 12 Sep, revising d.4). Somebody with `projects:manage` gets the two doors. Somebody
 * without gets one clear sentence — new work is raised by their account manager, and internal work
 * needs permission — rather than the browser's Print dialog opening on top of the app, which
 * confused people. Print is taken from the key in both cases (d.3), so the behaviour no longer
 * depends on who is pressing it.
 *
 * **Mounted in the shell**, like `UpdateBar`: it belongs to no page, because the shortcut works on
 * every page. Pages that offer the door (`/campaigns` → New) raise `OPEN_NEW_REQUEST_EVENT` rather
 * than importing this component's state (`lib/new-request`).
 */
export function NewRequestDoor() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const navigate = useNavigate()
  const canCreate = can('projects:manage')
  const [open, setOpen] = useState(false)
  const firstChoice = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open) return
      if (isNewRequestShortcut(e)) {
        e.preventDefault() // Print is the browser's, and it is taken knowingly (d.3).
        setOpen(true)
      }
    }
    function onOpen() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_NEW_REQUEST_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_NEW_REQUEST_EVENT, onOpen)
    }
  }, [open])

  useEffect(() => {
    if (open && canCreate) firstChoice.current?.focus()
  }, [open, canCreate])

  if (!open) return null

  function go(route: string) {
    setOpen(false)
    navigate(route)
  }

  if (!canCreate) {
    // Decision, 12 Sep: no dead Print dialog for someone who cannot create work — say who does.
    return (
      <Modal onClose={close} labelledById="intake-door-title" testId="new-request-no-access">
        <ModalHeader
          id="intake-door-title"
          eyebrow={t('intake.door.noAccess.eyebrow')}
          title={t('intake.door.noAccess.title')}
          subtitle={t('intake.door.noAccess.body')}
        />
        <ModalFooter>
          <Button variant="primary" onClick={close} data-testid="new-request-close">
            {t('common.gotIt')}
          </Button>
        </ModalFooter>
      </Modal>
    )
  }

  return (
    <Modal onClose={close} labelledById="intake-door-title" testId="new-request-door">
      <ModalHeader
        id="intake-door-title"
        title={t('intake.door.title')}
        subtitle={t('intake.door.intro')}
      />

      <div className="choice-cards">
        <ChoiceCard
          buttonRef={firstChoice}
          primary
          icon={<OneIcon />}
          title={t('intake.door.singleJob')}
          badge={t('intake.door.singleJobBadge')}
          description={t('intake.door.singleJobText')}
          onClick={() => go(SINGLE_JOB_ROUTE)}
          testId="new-request-single-job"
        />
        <ChoiceCard
          icon={<ManyIcon />}
          title={t('intake.door.fullCampaign')}
          badge={t('intake.door.fullCampaignBadge')}
          description={t('intake.door.fullCampaignText')}
          onClick={() => go(FULL_CAMPAIGN_ROUTE)}
          testId="new-request-full-campaign"
        />
      </div>

      <ModalFooter note={t('intake.door.promoteNote')}>
        <span className="modal-footer-hint">
          {t('intake.door.shortcutHint', { keys: shortcutLabel(navigator.platform ?? '') })}
        </span>
        <Button variant="secondary" onClick={close} data-testid="new-request-close">
          {t('common.cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function OneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="1.5" width="12" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 6h6M6 9h6M6 12h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ManyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9.5" y="2" width="6.5" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2" y="9.5" width="7" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
