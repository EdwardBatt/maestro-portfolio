import { test, expect } from '@playwright/test'
import { rows } from '../helpers/db'
import { as, idOf, rpcAs, at, workday } from '../helpers/i74'

/**
 * Coverage — the old deliverable window, which only ad-hoc work still opens (Edward, 5 Oct, A; I74.57).
 *
 * Campaign work opens on its campaign page (ADR-0132 d.8), so the Deliverables page's window is reached only by
 * ad-hoc work — none can be made in the app since 29 Sep (I66.10), but production still holds some. The door the
 * Schedule used, `create_adhoc_deliverable`, still makes one; the test makes it as the Creative department lead, then
 * opens and closes the window. Ad-hoc work shows the window's short layout, which has no owner control and no task-list
 * Approve (both shown only on campaign work, which never reaches this window — on the coverage baseline, to be deleted).
 */
test.describe('Coverage — the old deliverable window, on ad-hoc work', () => {
  test.describe.configure({ mode: 'serial' })
  let deliverableId = ''
  const title = `Ad-hoc retouch ${Date.now()}`

  test.beforeAll(async () => {
    const d = workday(3)
    const made = await rpcAs<{ sub_task_id: string; deliverable_id: string }[]>('lead', 'create_adhoc_deliverable', {
      p_assignee: await idOf('maker'),
      p_title: title,
      p_hours: 2,
      p_starts_at: at(d, 9),
      p_due_at: at(d, 11),
      p_reviewer: await idOf('lead'),
    })
    deliverableId = made[0]!.deliverable_id
    const [row] = await rows<{ stream_id: string | null }>('deliverables', `select=stream_id&id=eq.${deliverableId}`)
    expect(row?.stream_id, 'ad-hoc work has no campaign').toBeNull()
  })

  test('the window opens on ad-hoc work, stays on the Deliverables page, and Close shuts it', async ({ browser }) => {
    const lead = await as(browser, 'lead')
    await lead.goto('/deliverables')
    await lead.getByTestId('deliverables-tab-adhoc').click()
    await lead.getByTestId(`deliverable-open-${deliverableId}`).click()
    const dialog = lead.getByTestId('deliverable-detail-dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await expect(dialog).toContainText(title)
    // It stays here — ad-hoc work is not sent to a campaign page.
    await expect(lead).toHaveURL(/\/deliverables/)
    await lead.getByTestId('deliverable-detail-close').click()
    await expect(dialog).toHaveCount(0)
    await lead.context().close()
  })
})
