import { test, expect } from '@playwright/test'
import { attemptWrite, rows } from '../helpers/db'
import { as, blockTimeFill, PEOPLE, resourceIdOf, restAs, workday } from '../helpers/i74'

/**
 * Coverage — Block time on someone's week (I74.25, Figma L SC-22; ADR-0139 d.7 addendum, ADR-0142 d.4).
 *
 * A lead who may book blocks Leave or Internal work for the people in her scheduling reach — a team lead her own team —
 * without the leave grant, and the leave lands as the row the Leave page reads. "Amend on delivered work" is gone.
 *
 *   may      the Design team lead (`tl`, Nour in the demo data) blocks Leave for the maker (`maker`, Zubaida): a
 *            `resource_unavailability` row of kind leave, shown on the Leave page;
 *   may      she blocks Internal work for her team, with what for and the hours (− / +): a kind internal row;
 *            Cancel and the ✕ close the dialog and write nothing; the dialog offers Leave and Internal only;
 *   may NOT  another team's person (the Motion animator, the Content writer) is not offered in Who, and a direct write
 *            for them is refused by the database — no row;
 *   may NOT  a team member is not offered Block time, and her direct write is refused — no row.
 *
 * The days are far out (60+ working days) so nothing else in the suite reads them; they are cleared at start and end.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

const LEAVE_DAY = workday(60)
const LEAVE_TO = workday(61)
const INTERNAL_DAY = workday(63)
const startOf = (d: string) => `${d}T00:00:00Z`

type Block = { id: string; kind: string; hours: number | null; reason: string | null; starts_at: string; ends_at: string }
const blocksOn = (resourceId: string, from: string, to: string) =>
  rows<Block>('resource_unavailability',
    `select=id,kind,hours,reason,starts_at,ends_at&resource_id=eq.${resourceId}&starts_at=gte.${startOf(from)}&starts_at=lte.${to}T23:59:59Z`)

async function clear() {
  for (const tag of ['maker', 'animator', 'writer'] as const) {
    const r = await resourceIdOf(tag)
    const del = await attemptWrite('DELETE', 'resource_unavailability', `resource_id=eq.${r}&starts_at=gte.${startOf(LEAVE_DAY)}&starts_at=lte.${INTERNAL_DAY}T23:59:59Z`)
    expect(del.status, del.text).toBeLessThan(300)
  }
}

let makerRes: string
let animatorRes: string
let writerRes: string

test.describe('Block time (I74.25)', () => {
  test.beforeAll(async () => {
    makerRes = await resourceIdOf('maker')
    animatorRes = await resourceIdOf('animator')
    writerRes = await resourceIdOf('writer')
    await clear()
  })
  test.afterAll(async () => {
    await clear()
  })

  test('may: the team lead blocks Leave for her maker — the row is written and shows on the Leave page', async ({ browser }) => {
    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    await tl.getByTestId('block-time-open').click({ timeout: 20_000 })
    const dialog = tl.getByTestId('block-time')
    await expect(dialog).toBeVisible()
    // Leave and Internal work only — no amend (ADR-0142 d.4).
    await expect(dialog.locator('[role="radio"]')).toHaveCount(2)
    await expect(tl.getByTestId('block-time-leave')).toBeVisible()
    await expect(tl.getByTestId('block-time-internal')).toBeVisible()
    // Who: her own team, not another team's people.
    // I74.27: the Schedule's own pickers, not the browser's boxes.
    await expect(tl.getByTestId('block-time').locator('select, input[type="date"]')).toHaveCount(0)
    await tl.getByTestId('block-time-who').click()
    await expect(tl.getByTestId(`block-time-people-${makerRes}`)).toHaveCount(1)
    await expect(tl.getByTestId(`block-time-people-${animatorRes}`)).toHaveCount(0)
    await expect(tl.getByTestId(`block-time-people-${writerRes}`)).toHaveCount(0)
    await tl.getByTestId('block-time-who').click()

    await tl.getByTestId('block-time-leave').click()
    await blockTimeFill(tl, makerRes, LEAVE_DAY, LEAVE_TO)
    await expect(tl.getByTestId('block-time-who')).toContainText(PEOPLE.maker.name)
    await tl.getByTestId('block-time-save').click()
    await expect(dialog).toHaveCount(0)
    await expect(tl.getByTestId('schedule-toast')).toContainText(PEOPLE.maker.name)
    await tl.context().close()

    await expect.poll(async () => (await blocksOn(makerRes, LEAVE_DAY, LEAVE_TO)).length).toBe(1)
    const [leave] = await blocksOn(makerRes, LEAVE_DAY, LEAVE_TO)
    expect(leave).toMatchObject({ kind: 'leave', starts_at: expect.stringContaining(LEAVE_DAY), ends_at: expect.stringContaining(LEAVE_TO) })

    // The same row the Leave page reads.
    const admin = await as(browser, 'admin')
    await admin.goto('/people/leave')
    await expect(admin.getByTestId(`leave-row-${leave!.id}`)).toBeVisible({ timeout: 20_000 })
    await expect(admin.getByTestId(`leave-row-${leave!.id}`)).toContainText(PEOPLE.maker.name)
    await admin.context().close()
  })

  test('may: Internal work with what for and the hours; Cancel and ✕ write nothing', async ({ browser }) => {
    const tl = await as(browser, 'tl')
    await tl.goto('/schedule')
    // Cancel, then ✕: closed, nothing written.
    await tl.getByTestId('block-time-open').click({ timeout: 20_000 })
    await tl.getByTestId('block-time-cancel').click()
    await expect(tl.getByTestId('block-time')).toHaveCount(0)
    await tl.getByTestId('block-time-open').click()
    await tl.getByTestId('block-time-close').click()
    await expect(tl.getByTestId('block-time')).toHaveCount(0)
    expect(await blocksOn(makerRes, INTERNAL_DAY, INTERNAL_DAY)).toEqual([])

    await tl.getByTestId('block-time-open').click()
    await tl.getByTestId('block-time-internal').click()
    await tl.getByTestId('block-time-what').fill('Agency pitch deck')
    await blockTimeFill(tl, makerRes, INTERNAL_DAY)
    await expect(tl.getByTestId('block-time-hours')).toContainText('1')
    await tl.getByTestId('block-time-more').click()
    await tl.getByTestId('block-time-more').click()
    await tl.getByTestId('block-time-less').click()
    await expect(tl.getByTestId('block-time-hours')).toContainText('1.5')
    await tl.getByTestId('block-time-save').click()
    await expect(tl.getByTestId('block-time')).toHaveCount(0)
    await expect(tl.getByTestId('schedule-toast')).toContainText('Agency pitch deck')
    await tl.context().close()

    await expect.poll(async () => (await blocksOn(makerRes, INTERNAL_DAY, INTERNAL_DAY)).length).toBe(1)
    const [row] = await blocksOn(makerRes, INTERNAL_DAY, INTERNAL_DAY)
    expect(row).toMatchObject({ kind: 'internal', reason: 'Agency pitch deck' })
    expect(Number(row!.hours)).toBe(1.5)
  })

  test('may NOT: the team lead cannot block time for another team\'s person — the database refuses, no row', async () => {
    const [{ tenant_id }] = await rows<{ tenant_id: string }>('resources', `select=tenant_id&id=eq.${makerRes}`)
    for (const res of [animatorRes, writerRes]) {
      for (const kind of ['leave', 'internal'] as const) {
        const w = await restAs('tl', 'POST', 'resource_unavailability', '', {
          tenant_id, resource_id: res, kind, category: kind === 'leave' ? 'planned' : null,
          starts_at: startOf(LEAVE_DAY), ends_at: `${LEAVE_DAY}T23:59:59Z`, hours: kind === 'internal' ? 2 : null, reason: null,
        })
        expect(w.status, w.text).toBe(403)
        expect(w.text).toMatch(/row-level security/)
      }
      expect(await blocksOn(res, LEAVE_DAY, INTERNAL_DAY)).toEqual([])
    }
  })

  test('may NOT: a team member is not offered Block time, and her own write is refused — no row', async ({ browser }) => {
    const mk = await as(browser, 'maker')
    await mk.goto('/schedule')
    await expect(mk.getByTestId('surface-schedule')).toBeVisible({ timeout: 20_000 })
    await expect(mk.getByTestId('block-time-open')).toHaveCount(0)
    await mk.context().close()

    const [{ tenant_id }] = await rows<{ tenant_id: string }>('resources', `select=tenant_id&id=eq.${makerRes}`)
    const before = (await blocksOn(makerRes, LEAVE_DAY, INTERNAL_DAY)).length
    const w = await restAs('maker', 'POST', 'resource_unavailability', '', {
      tenant_id, resource_id: makerRes, kind: 'leave', category: 'planned',
      starts_at: startOf(workday(62)), ends_at: `${workday(62)}T23:59:59Z`, hours: null, reason: null,
    })
    expect(w.status, w.text).toBe(403)
    expect((await blocksOn(makerRes, LEAVE_DAY, INTERNAL_DAY)).length).toBe(before)
  })
})
