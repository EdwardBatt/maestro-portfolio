import { describe, expect, it } from 'vitest'
import { arithmeticText } from './extension-text'

// The keys and their parameters, so a wording change is visible here rather than in a screenshot.
const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? ' ' + JSON.stringify(o) : ''}`

describe('arithmeticText (ADR-0088 d.7, ADR-0093, I48.25)', () => {
  it('names fine / tight / at risk with the days and the buffer', () => {
    expect(arithmeticText({ severity: 'fine', workingDaysLeft: 4, bufferDays: 1, slackDays: 3 }, true, t))
      .toBe('deadlineExtension.arithmetic_fine {"days":4,"buffer":1}')
    expect(arithmeticText({ severity: 'at_risk', workingDaysLeft: 0, bufferDays: 1, slackDays: -1 }, true, t))
      .toBe('deadlineExtension.arithmetic_at_risk {"days":0,"buffer":1}')
  })

  it('says "past the due date" instead of a negative count (I48.25)', () => {
    expect(arithmeticText({ severity: 'at_risk', workingDaysLeft: -27, bufferDays: 1, slackDays: -28 }, true, t))
      .toBe('deadlineExtension.arithmetic_past_due {"days":27}')
  })

  it('after go-live is a sentence about the client, not a refusal (ADR-0093)', () => {
    expect(arithmeticText({ severity: 'after_go_live', workingDaysLeft: null, bufferDays: 1, slackDays: null }, true, t))
      .toBe('deadlineExtension.arithmetic_after_go_live')
  })

  it('with no deliverable due date there is nothing to measure against', () => {
    expect(arithmeticText({ severity: 'fine', workingDaysLeft: null, bufferDays: 1, slackDays: null }, false, t))
      .toBe('deadlineExtension.arithmetic_none')
  })
})
