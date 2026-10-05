import { test, expect } from '@playwright/test'
import { authFile, PEOPLE } from './fixtures'
import { attemptWrite, rows, userIdOf, waitForNotification } from './helpers/db'
import { clearMailbox, expectMail, expectNoMail, readMailHtml } from './helpers/mailpit'
import { closeCampaignBanner } from './helpers/piece'

/**
 * docs/E2E-PLAN.md §5 — notifications and email, on one exemplar event: a deliverable changes
 * hands (ADR-0055 d.9, type `deliverable_reassigned`). The same three assertions apply to every
 * type in the matrix: the ROW is written (in-transaction, addressed to the right person, never to
 * the actor), the INBOX shows it to that person, and the EMAIL reaches Mailpit with the deep link.
 *
 * Actors: the Creative lead owns "Social statics" on the running campaign; its account manager hands it to the
 * Motion team lead (ADR-0141 d.1: the account manager changes a deliverable, the owner and the leads ask). The
 * account manager is the actor and must NOT be told; the Motion lead must, twice.
 * Cleans up by handing it back (which notifies the other way — cleared before the next family).
 */
const DELIVERABLE = 'Social statics'

/**
 * The owner, changed on the piece's panel on its campaign page and saved (ADR-0132 d.2/d.8: the owner is one of the
 * panel's fields, saved with "Save the deliverable"; the deliverable page's own Change owner is gone).
 */
async function changeOwner(page: import('@playwright/test').Page, campaignId: string, deliverableId: string, ownerId: string) {
  await page.goto(`/campaigns/${campaignId}?piece=${deliverableId}`)
  await expect(page.getByTestId('piece-panel')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('piece-panel-owner').click()
  await page.getByTestId(`piece-panel-owner-option-${ownerId}`).dispatchEvent('mousedown')
  await page.getByTestId('piece-panel-save').click()
  await closeCampaignBanner(page)
  await expect
    .poll(async () => (await rows<{ owner_user_id: string | null }>('deliverables', `select=owner_user_id&id=eq.${deliverableId}`))[0]!.owner_user_id)
    .toBe(ownerId)
}

test.describe('notifications — a deliverable changes hands', () => {
  test.beforeAll(async () => {
    await clearMailbox()
  })

  test('the row, the inbox and the email all reach the new owner and not the actor', async ({ browser }) => {
    // --- as the account manager: change the owner (ADR-0141 d.1)
    const amCtx = await browser.newContext({ storageState: authFile('am') })
    const am = await amCtx.newPage()
    const [d] = await rows<{ id: string; streams: { campaign_id: string } }>('deliverables', `select=id,streams(campaign_id)&name=eq.${encodeURIComponent(DELIVERABLE)}`)
    expect(d, `seeded deliverable "${DELIVERABLE}"`).toBeTruthy()
    const campaignOf = d.streams.campaign_id
    // The database is long-lived: a run that died before handing the deliverable back leaves the
    // Motion lead as owner, and then this "change" changes nothing and sends nothing (traps.md).
    // Put it back at the START, as the service role — no actor, so no notification.
    await attemptWrite('PATCH', 'deliverables', `id=eq.${d.id}`, { owner_user_id: await userIdOf(PEOPLE.lead.email) })

    await changeOwner(am, campaignOf, d.id, await userIdOf(PEOPLE.motiontl.email))

    // --- the ROW: written in-transaction, addressed to the new owner
    const row = await waitForNotification(PEOPLE.motiontl.email, 'deliverable_reassigned', 8_000, d.id)
    expect(row.label).toBe(DELIVERABLE)
    expect(row.entity_id).toBe(d.id)

    // --- the INBOX, as the Motion lead (a fresh page: the live push is I48.17, parked)
    const tlCtx = await browser.newContext({ storageState: authFile('motiontl') })
    const tl = await tlCtx.newPage()
    await tl.goto('/my-work')
    await expect(tl.getByTestId('notif-badge')).toBeVisible()
    await tl.getByTestId('notif-bell').click()
    const item = tl.getByTestId(`notif-${row.id}`)
    await expect(item).toBeVisible()
    await expect(item).toContainText(DELIVERABLE)
    // Following it lands on the campaign page, where a deliverable is read about (I59.45).
    await item.click()
    await expect(tl).toHaveURL(new RegExp(`/campaigns/${campaignOf}`))

    // --- the EMAIL (I52 Action 2): to the new owner, "Assigned to you", with the deep link; the
    // old owner gets one line saying who has it; none to the actor
    const mail = await expectMail(PEOPLE.motiontl.email, /^Assigned to you: /)
    const html = await readMailHtml(mail.ID)
    expect(html).toContain(DELIVERABLE)
    expect(html).toContain(`/campaigns/${campaignOf}`)
    await expectNoMail(PEOPLE.am.email)

    // --- hand it back, so the seed's shape survives for the next family
    await changeOwner(am, campaignOf, d.id, await userIdOf(PEOPLE.lead.email))

    await tlCtx.close()
    await amCtx.close()
    await clearMailbox()
  })
})
