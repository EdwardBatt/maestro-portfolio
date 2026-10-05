import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NoticeBox } from './NoticeBox'

describe('NoticeBox', () => {
  it('renders one paragraph per line, in order', () => {
    render(<NoticeBox testId="nb" lines={['First line.', 'Second line.']} />)
    expect(screen.getByTestId('nb-line-0')).toHaveTextContent('First line.')
    expect(screen.getByTestId('nb-line-1')).toHaveTextContent('Second line.')
  })

  it('drops falsy lines so callers can pass a conditional second paragraph', () => {
    render(<NoticeBox testId="nb" lines={['Only this.', false, null, undefined]} />)
    expect(screen.getByTestId('nb-line-0')).toHaveTextContent('Only this.')
    expect(screen.queryByTestId('nb-line-1')).toBeNull()
  })

  it('renders nothing at all when every line is empty', () => {
    const { container } = render(<NoticeBox lines={[false, undefined]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('defaults to the warning tone', () => {
    render(<NoticeBox testId="nb" lines={['Careful.']} />)
    expect(screen.getByTestId('nb')).toHaveClass('notice-warn')
  })

  it('carries the tone it is given', () => {
    render(<NoticeBox testId="nb" kind="breach" lines={['Wrong.']} />)
    expect(screen.getByTestId('nb')).toHaveClass('notice-breach')
    expect(screen.getByTestId('nb')).not.toHaveClass('notice-warn')
  })
})
