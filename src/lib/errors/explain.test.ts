import { describe, expect, it } from 'vitest'
import { explainFailure } from './explain'

describe('explainFailure (I66.12)', () => {
  it("says what Mais's report meant", () => {
    expect(explainFailure('23514', 'campaign_not_draft')).toMatch(/already been sent for approval/)
  })
  it('falls back to the code, and says nothing it does not know', () => {
    expect(explainFailure('42501', 'you cannot approve this campaign')).toMatch(/not allowed/)
    expect(explainFailure('23514', 'some_other_check')).toMatch(/rules was not met/)
    expect(explainFailure('XX000', 'something odd')).toBeNull()
    expect(explainFailure(undefined, undefined)).toBeNull()
  })
})
