import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { FillerWarning } from './FillerWarning'

describe('FillerWarning (ADR-0111, E10)', () => {
  it('warns beside a field that holds only placeholder text', () => {
    render(<FillerWarning text="XYZ 123" testId="w" />)
    expect(screen.getByTestId('w')).toHaveTextContent('“XYZ 123” is placeholder text — write the real thing.')
  })

  it('says nothing for real text or a blank field', () => {
    const { rerender } = render(<FillerWarning text="Test the new pack shot" testId="w" />)
    expect(screen.queryByTestId('w')).toBeNull()
    rerender(<FillerWarning text="   " testId="w" />)
    expect(screen.queryByTestId('w')).toBeNull()
  })

  it("counts the tenant's own words", () => {
    const { rerender } = render(<FillerWarning text="Coming soon" testId="w" />)
    expect(screen.queryByTestId('w')).toBeNull()
    rerender(<FillerWarning text="Coming soon" extraWords={['coming soon']} testId="w" />)
    expect(screen.getByTestId('w')).toBeInTheDocument()
  })
})
