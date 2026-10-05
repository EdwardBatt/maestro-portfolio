import { describe, expect, it } from 'vitest'
import { fromChangeAsks, fromEscalations, type ChangeAskNeedRow, type EscalationRow } from './needs-you-requests'

const say = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ''}`

const row = (over: Partial<ChangeAskNeedRow> = {}): ChangeAskNeedRow => ({
  id: 'a1', deliverableId: 'd1', askedBy: 'fadia', askedByName: 'Fadia', kinds: ['hours', 'due_date'],
  requestedDueDay: '2026-10-04', requestedHours: 16, reason: 'Too tight', fromSubTaskId: null, status: 'pending',
  answeredBy: null, answeredByName: null, answeredAt: null, answerNote: null, appliedDueDay: null, appliedHours: null,
  escalatedAt: null, createdAt: '2026-10-03T08:00:00Z', deliverableName: 'Post 2', campaignId: 'c1', campaignName: 'LUMA',
  ...over,
})

describe('Needs you — a change asked of the account manager (ADR-0141 d.4)', () => {
  it('is one card per ask with the answer dialog, its clock from the deliverable_change rule', () => {
    const [it0] = fromChangeAsks([row()], new Map([['deliverable_change', 4]]), say)
    expect(it0?.kind).toBe('deliverable_change')
    expect(it0?.title).toContain('Fadia')
    expect(it0?.title).toContain('Post 2')
    expect(it0?.context).toContain('Too tight')
    expect(it0?.clock.escalatesAt).toBe('2026-10-03T12:00:00.000Z')
    expect(it0?.primary).toMatchObject({ type: 'dialog', dialog: 'change_ask_answer', mode: 'accept' })
    expect(it0?.secondary).toMatchObject({ type: 'dialog', dialog: 'change_ask_answer', mode: 'keep' })
  })

  it('once escalated, the clock is the escalation’s own instant', () => {
    const [it0] = fromChangeAsks([row({ escalatedAt: '2026-10-03T13:30:00Z' })], new Map(), say)
    expect(it0?.clock.escalatesAt).toBe('2026-10-03T13:30:00Z')
  })

  it('the account director’s escalation names the kind, not "other", and opens the piece', () => {
    const esc: EscalationRow = {
      notificationId: 'n1', kind: 'deliverable_change', entityType: 'deliverable', entityId: 'd1', label: 'Post 2',
      contextLabel: null, detail: { threshold: 4 }, escalatedAt: '2026-10-03T13:30:00Z', campaignId: 'c1',
    } as EscalationRow
    const [it0] = fromEscalations([esc], say)
    expect(it0?.title).toContain('requests.ny.escalated.deliverable_change')
    expect(it0?.primary).toMatchObject({ type: 'link' })
  })
})
