import { test, expect } from '@playwright/test'
import { authFile, OFFICES } from './fixtures'
import { rows } from './helpers/db'

/**
 * docs/RETEST-REDESIGN.md section M — office closures (ADR-0079, I41.11/I41.12).
 *
 * Runs as the Power Admin (holds leave:manage). Declares a two-day closure on Baghdad half a year
 * out, then checks: the row lists with its office; the stranded panel appears and says nothing is
 * booked; the schedule shades those two days for a Baghdad row and NOT for the Dubai one; the leave
 * form no longer offers "holiday". Cleans up the closure at the end.
 *
 * Why half a year out, not next week: the local database is long-lived (the config's "a full reset
 * is the runner's call"), and every other family books next week — by the second run that week held
 * 118 Baghdad bookings and the empty stranded list could never show. The empty state is still what
 * is tested; the test first PROVES the days are empty in the database, so it fails loudly (rather
 * than quietly testing something else) if anything ever books there.
 */
test.use({ storageState: authFile('admin') })

/**
 * The Tuesday and Wednesday 26 weeks from now in YYYY-MM-DD — working days in both offices, so the
 * shading is the closure's, and far past the "next week" every other family books into.
 */
function farTueWed(): [string, string] {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  const day = d.getUTCDay() // 0 Sun … 6 Sat
  const toFarTue = ((2 - day + 7) % 7) + 26 * 7
  const tue = new Date(d.getTime() + toFarTue * 86_400_000)
  const wed = new Date(tue.getTime() + 86_400_000)
  return [tue.toISOString().slice(0, 10), wed.toISOString().slice(0, 10)]
}

/**
 * A YYYY-MM-DD day as the closures table prints it (I66.8): "Tue, 6 Apr", and " 2027" only when the
 * year is not this one. Written out here rather than imported, so the test is a second opinion.
 */
function dayWords(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const year = d.getUTCFullYear() !== new Date().getUTCFullYear() ? ` ${d.getUTCFullYear()}` : ''
  return `${wd}, ${d.getUTCDate()} ${mo}${year}`
}

test.describe('M — office closures', () => {
  const [start, end] = farTueWed()
  const name = `Eid (e2e ${start})`

  test('M2/M3 — declare a closure on an office; the stranded list appears', async ({ page }) => {
    // The precondition, proved rather than assumed: nothing live is booked for a Baghdad resource on
    // those days (the same overlap `office_closure_stranded_bookings` uses, in Baghdad's +03:00).
    const baghdad = await rows<{ id: string }>('resources', `select=id,offices!inner(name)&offices.name=eq.${OFFICES.baghdad}`)
    expect(baghdad.length).toBeGreaterThan(0)
    const booked = await rows<{ id: string }>(
      'bookings',
      `select=id&state=neq.cancelled&resource_id=in.(${baghdad.map((r) => r.id).join(',')})` +
        `&starts_at=lt.${encodeURIComponent(`${end}T24:00:00+03:00`)}&ends_at=gt.${encodeURIComponent(`${start}T00:00:00+03:00`)}`,
    )
    expect(booked, 'the closure days must be empty for the empty stranded list to be the right answer').toEqual([])

    await page.goto('/people/leave')
    await expect(page.getByTestId('surface-leave')).toBeVisible()

    await page.getByTestId('closure-add').click()
    const dialog = page.getByTestId('closure-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('closure-office').selectOption({ label: OFFICES.baghdad })
    await dialog.getByTestId('closure-kind').selectOption('public_holiday')
    await dialog.getByTestId('closure-name').fill(name)
    await dialog.getByTestId('closure-start').fill(start)
    await dialog.getByTestId('closure-end').fill(end)
    await dialog.getByTestId('closure-submit').click()

    // A save reports itself in a dialog in front of the person (Edward, 29 Aug; Notice.tsx), and that
    // dialog sits above the page — it is read and closed before anything behind it can be pressed.
    await expect(page.getByTestId('leave-banner-dialog')).toBeVisible()
    await page.getByTestId('leave-banner-close').click()
    await expect(page.getByTestId('leave-banner-dialog')).toHaveCount(0)

    // The row, with the OFFICE (not a person).
    const table = page.getByTestId('closures-table')
    await expect(table).toContainText(name)
    await expect(table).toContainText(OFFICES.baghdad)
    // I66.8 — dates read as words, not ISO.
    await expect(table).toContainText(dayWords(start))
    await expect(table).toContainText(dayWords(end))

    // d.6 — the stranded list opens straight away, and says nothing is booked (proved above).
    const panel = page.getByTestId('stranded-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText(name)
    await expect(page.getByTestId('stranded-empty')).toBeVisible()
    await page.getByTestId('stranded-dismiss').click()
    await expect(panel).toHaveCount(0)

    // And the row exists in the database, keyed by office.
    const stored = await rows<{ name: string; starts_on: string; ends_on: string; kind: string }>(
      'office_closures',
      `select=name,starts_on,ends_on,kind&name=eq.${encodeURIComponent(name)}`,
    )
    expect(stored).toEqual([{ name, starts_on: start, ends_on: end, kind: 'public_holiday' }])
  })

  test('M4 — the grid shades the closed days for Baghdad rows and not for Dubai', async ({ page }) => {
    // Open the week that holds the closure; `?on=` opens the week containing that day.
    await page.goto(`/schedule?on=${start}`)
    await expect(page.getByTestId('schedule-grid')).toBeVisible()

    // A Baghdad person (the Producer) and the Dubai one (the Editor), by their resource rows.
    const [producer] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent('Dev Producer')}`)
    const [editor] = await rows<{ id: string }>('resources', `select=id&name=eq.${encodeURIComponent('Dev Editor (Dubai)')}`)
    expect(producer && editor).toBeTruthy()

    // The grid shows every active resource by default; the two cells on the closed Tuesday.
    const baghdadCell = page.getByTestId(`cell-${producer.id}-${start}`)
    const dubaiCell = page.getByTestId(`cell-${editor.id}-${start}`)
    await expect(baghdadCell).toBeVisible()
    await expect(dubaiCell).toBeVisible()
    await expect(baghdadCell).toHaveClass(/nonworking/)
    await expect(dubaiCell).not.toHaveClass(/nonworking/)
  })

  test('M7 — the leave form offers leave only', async ({ page }) => {
    await page.goto('/people/leave')
    await page.getByTestId('leave-add').click()
    const kinds = await page.getByTestId('leave-kind').locator('option').allTextContents()
    expect(kinds).toHaveLength(1)
    await page.getByTestId('leave-cancel').click()
  })

  test.afterAll(async ({ browser }) => {
    // Remove the closure through the product (two-step delete), so the next family starts clean.
    const context = await browser.newContext({ storageState: authFile('admin') })
    const page = await context.newPage()
    await page.goto('/people/leave')
    const [row] = await rows<{ id: string }>('office_closures', `select=id&name=eq.${encodeURIComponent(name)}`)
    if (row) {
      const del = page.getByTestId(`closure-delete-${row.id}`)
      await del.click()
      await del.click()
      await expect(page.getByTestId(`closure-row-${row.id}`)).toHaveCount(0)
    }
    await context.close()
  })
})
