import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../lib/i18n'
import { ProgressBar, ProgressTip } from './DeliverableProgress'

const p = (over: Partial<{ done: number; everTotal: number; inReview: number; inProgress: number; notStarted: number }> = {}) => ({
  done: 2, everTotal: 8, inReview: 1, inProgress: 3, notStarted: 2, ...over,
})

/** I67.4 (Edward, 30 Sep, A): the numbers behind a deliverable's status word, and the bar that draws them. */
describe('DeliverableProgress', () => {
  it('gives one line per status, "x of y – status", under the status word', () => {
    render(<ProgressTip progress={p()} status="In progress"><span>In progress</span></ProgressTip>)
    const body = screen.getByTestId('progress-tip-body')
    const lines = [...body.querySelectorAll('.info-tip-line')].map((l) => l.textContent)
    expect(body.querySelector('.info-tip-title')).toHaveTextContent('In progress')
    expect(lines).toEqual(['2 of 8 – Done', '1 of 8 – In review', '3 of 8 – In progress', '2 of 8 – Not started'])
  })

  it('leaves out a status there are none of, and never says the same fact twice', () => {
    render(<ProgressTip progress={p({ done: 2, inReview: 0, inProgress: 0, notStarted: 0, everTotal: 2 })} status="Delivered"><span>x</span></ProgressTip>)
    const lines = [...screen.getByTestId('progress-tip-body').querySelectorAll('.info-tip-line')].map((l) => l.textContent)
    expect(lines).toEqual(['2 of 2 – Done'])
  })

  it('draws a segment per kind of task, sized by its count', () => {
    render(<ProgressBar progress={p()} />)
    const bar = screen.getByTestId('progress-bar')
    expect(bar).toHaveTextContent('2 of 8 done')
    const segs = [...bar.querySelectorAll('i')]
    expect(segs.map((s) => s.className)).toEqual(['is-done', 'is-review', 'is-progress', 'is-todo'])
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['2', '1', '3', '2'])
  })

  it('shows nothing extra for a piece with no tasks — the pill alone', () => {
    const none = p({ done: 0, everTotal: 0, inReview: 0, inProgress: 0, notStarted: 0 })
    const { container } = render(<><ProgressBar progress={none} /><ProgressTip progress={none} status="No tasks yet"><span>pill</span></ProgressTip></>)
    expect(screen.queryByTestId('progress-bar')).toBeNull()
    expect(screen.queryByTestId('progress-tip')).toBeNull()
    expect(container).toHaveTextContent('pill')
  })
})
