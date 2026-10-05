import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isChimeOn, playChime, primeChime, setChimeOn } from '../../lib/notifications/chime'

/**
 * ADR-0113 d.4 (I59.28): the sound switch beside the bell — on by default, remembered on this device.
 *
 * An icon switch (`role="switch"`), not a text button: it is a standing setting, and the label and
 * tooltip say what it does. Turning it on plays the chime once, so the person hears what they chose
 * (the press is itself the gesture a browser needs before it plays sound).
 */
export function ChimeSwitch() {
  const { t } = useTranslation()
  const [on, setOn] = useState(isChimeOn)
  const label = on ? t('escalations.chime.turnOff') : t('escalations.chime.turnOn')

  function toggle() {
    const next = !on
    setChimeOn(next)
    setOn(next)
    if (next) {
      primeChime()
      playChime()
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      className={`icon-btn chime-switch${on ? ' is-on' : ''}`}
      onClick={toggle}
      data-testid="notif-chime-switch"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        {on ? (
          <>
            <path d="M15.5 8.5a5 5 0 010 7" />
            <path d="M18.5 5.5a9 9 0 010 13" />
          </>
        ) : (
          <path d="M22 9l-6 6M16 9l6 6" />
        )}
      </svg>
    </button>
  )
}
