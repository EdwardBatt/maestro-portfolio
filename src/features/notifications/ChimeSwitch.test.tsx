import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../lib/i18n'
import { ChimeSwitch } from './ChimeSwitch'
import { CHIME_STORAGE_KEY, isChimeOn, resetChimeForTests } from '../../lib/notifications/chime'

describe('ChimeSwitch — the sound switch by the bell (ADR-0113 d.4)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetChimeForTests()
  })

  it('is on by default and says what pressing it does', () => {
    render(<ChimeSwitch />)
    const sw = screen.getByTestId('notif-chime-switch')
    expect(sw).toHaveAttribute('role', 'switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(sw).toHaveAccessibleName('Turn notification sound off')
  })

  it('turns off and on, and remembers the choice on this device', () => {
    const { unmount } = render(<ChimeSwitch />)
    fireEvent.click(screen.getByTestId('notif-chime-switch'))
    expect(screen.getByTestId('notif-chime-switch')).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem(CHIME_STORAGE_KEY)).toBe('off')
    expect(isChimeOn()).toBe(false)
    unmount()

    render(<ChimeSwitch />)
    const sw = screen.getByTestId('notif-chime-switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAccessibleName('Turn notification sound on')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(isChimeOn()).toBe(true)
  })
})
