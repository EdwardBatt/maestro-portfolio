// ADR-0045 d.1 / ADR-0108 (I59.24) — the stall sweep's door: the cron secret, the dry run, the envelope.
import { describe, expect, it, vi } from 'vitest'
import { createStallSweepHandler, summarise, timingSafeEqual, type StallSweepDeps } from './handler.ts'

const RESULT = {
  dry_run: true,
  now: '2026-09-26T09:00:00Z',
  sent: 0,
  due: 3,
  items: [
    { kind: 'unassigned', entity_type: 'deliverable', entity_id: 'd1', label: 'Carousel', hours: 26, threshold: 24,
      recipients: [{ user_id: 'u1', reasons: ['role'] }, { user_id: 'u2', reasons: ['owner'] }] },
    { kind: 'review_remind', entity_type: 'sub_task', entity_id: 't1', label: 'Design', hours: 25, threshold: 24,
      recipients: [{ user_id: 'u3', reasons: ['reviewers'] }] },
    { kind: 'over_capacity', entity_type: 'resource', entity_id: 'r1', label: 'Sara', hours: null, threshold: 110,
      recipients: [] },
  ],
}

function deps(over: Partial<StallSweepDeps> = {}): StallSweepDeps {
  return { cronSecret: 's3cret', runSweep: vi.fn(async () => ({ data: RESULT, error: null })), ...over }
}
const post = (body: unknown, secret = 's3cret') =>
  new Request('https://f.test', { method: 'POST', headers: { 'x-cron-secret': secret }, body: JSON.stringify(body) })

describe('stall-sweep handler', () => {
  it('refuses anything but POST', async () => {
    const res = await createStallSweepHandler(deps())(new Request('https://f.test'))
    expect(res.status).toBe(405)
  })

  it('refuses a wrong or missing cron secret, and never runs the sweep', async () => {
    const d = deps()
    expect((await createStallSweepHandler(d)(post({}, 'nope'))).status).toBe(401)
    expect((await createStallSweepHandler(deps({ cronSecret: undefined }))(post({}))).status).toBe(401)
    expect(d.runSweep).not.toHaveBeenCalled()
  })

  it('refuses a malformed body', async () => {
    const res = await createStallSweepHandler(deps())(post({ dryRun: 'yes' }))
    expect(res.status).toBe(400)
  })

  it('a dry run asks the database for a dry run and lists what each rung would send', async () => {
    const d = deps()
    const res = await createStallSweepHandler(d)(post({ dryRun: true }))
    expect(d.runSweep).toHaveBeenCalledWith(true)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.items).toHaveLength(3)
    expect(body.byKind).toEqual({
      unassigned: { causes: 1, recipients: 2 },
      review_remind: { causes: 1, recipients: 1 },
      over_capacity: { causes: 1, recipients: 0 },
    })
  })

  it('a live run reports how many causes were escalated', async () => {
    const d = deps({ runSweep: vi.fn(async () => ({ data: { ...RESULT, dry_run: false, sent: 2 }, error: null })) })
    const res = await createStallSweepHandler(d)(post({}))
    expect(d.runSweep).toHaveBeenCalledWith(false)
    expect((await res.json()).escalated).toBe(2)
  })

  it('never echoes a database error', async () => {
    const d = deps({ runSweep: vi.fn(async () => ({ data: null, error: { message: 'relation "x" does not exist' } })) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createStallSweepHandler(d)(post({}))
    spy.mockRestore()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
  })

  it('summarise counts causes and people per kind', () => {
    expect(summarise({ ...RESULT, items: [] })).toEqual({})
  })

  it('timingSafeEqual compares exactly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
