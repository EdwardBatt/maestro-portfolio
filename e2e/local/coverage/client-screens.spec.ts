import { test, expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE, CLIENTS } from '../fixtures'
import { rows, userIdOf } from '../helpers/db'

/**
 * Coverage — I62.10: the client screens of ADR-0123 (Figma J and CV-01/CV-02), every control pressed and
 * its outcome read: the six registration steps (Cancel, Back, Skip, the stepper, Review's Edit links, the
 * duplicate check's two answers), the brands / people / dos-and-don'ts editors (add, edit, save, remove,
 * the people's switches), the list (tabs, a row, a draft's Continue / Ask / Review) and the client's page
 * (tabs, Continue, Add brand, a brand tile, the Library, New job).
 *
 * Who may (ADR-0123 d.1, d.5; role_grants on the local stack): `traffic` holds clients:manage and not
 * clients:approve — registers, continues, asks; `ad` holds clients:approve — reviews, activates, and alone
 * changes an active client's rules. `lead` holds clients:view only — sees the list and the page, offered no
 * editor; `maker` holds no clients permission and is sent away from the page.
 *
 * The suite makes its own client (a run-stamped name), so nothing depends on what earlier runs left. Names
 * of people are never typed: the local database may carry the demo scripts' renames (docs/memory/traps.md).
 * Serial: each test builds on the client the one before it registered.
 */
test.use({ actionTimeout: 15_000 })
test.describe.configure({ mode: 'serial' })

async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const stamp = Date.now()
const NAME = `Cov client screens ${stamp}`
const BRAND_A = `Cov brand A ${stamp}`
const BRAND_B = `Cov brand B ${stamp}`
const CONTACT_A = `Cov contact A ${stamp}`
const CONTACT_B = `Cov contact B ${stamp}`

let clientId = ''
let brandA = ''
let contactA = ''

type Brand = { id: string; name: string; short_name: string | null }
type Contact = { id: string; name: string; role_title: string | null; signs_off: boolean; can_request: boolean }
type Client = { id: string; status: string; activation_requested_at: string | null; profile: { rules?: { kind: string; text: string }[] } }

const brandsOf = (id: string) => rows<Brand>('brands', `select=id,name,short_name&client_id=eq.${id}&order=created_at.asc`)
const contactsOf = (id: string) => rows<Contact>('client_contacts', `select=id,name,role_title,signs_off,can_request&client_id=eq.${id}&order=created_at.asc`)
const clientRow = async (id: string) => (await rows<Client>('clients', `select=id,status,activation_requested_at,profile&id=eq.${id}`))[0]!

test.describe('Coverage — the client screens (I62.10, ADR-0123)', () => {
  test('registering: Cancel leaves; Basics saves a draft; brands, people and rules are added, edited and removed; Back, Skip, the stepper and Review’s Edit move between steps', async ({ browser }) => {
    test.setTimeout(180_000)
    const traffic = await as(browser, 'traffic')

    // Cancel on a new client's Basics goes back to the list and writes nothing.
    await traffic.goto('/clients/new')
    await expect(traffic.getByTestId('client-wizard')).toHaveAttribute('data-step', '1')
    await traffic.getByTestId('client-name').fill(`${NAME} not saved`)
    await traffic.getByTestId('client-cancel').click()
    await expect(traffic).toHaveURL(/\/clients$/)
    await expect(traffic.getByTestId('surface-clients')).toBeVisible()
    expect(await rows('clients', `select=id&name=eq.${encodeURIComponent(`${NAME} not saved`)}`)).toHaveLength(0)

    // Basics → Next saves the draft and opens Brands.
    await traffic.goto('/clients/new')
    await traffic.getByTestId('client-name').fill(NAME)
    await traffic.getByTestId('client-country').selectOption('IQ')
    await traffic.getByTestId('client-am').selectOption(await userIdOf(PEOPLE.am.email))
    await traffic.getByTestId('client-next').click()
    await expect(traffic).toHaveURL(/\/clients\/[0-9a-f-]{36}\/register\?step=2$/)
    clientId = traffic.url().match(/\/clients\/([0-9a-f-]{36})\//)![1]!
    expect((await clientRow(clientId)).status).toBe('draft')
    const wizard = traffic.getByTestId('client-wizard')
    await expect(wizard).toHaveAttribute('data-step', '2')

    // Brands: two added (name + short name), the first edited, the second removed.
    await traffic.getByTestId('client-brand-name').fill(BRAND_A)
    await traffic.getByTestId('client-brand-short').fill('CBA')
    await traffic.getByTestId('client-brand-add').click()
    await expect.poll(async () => (await brandsOf(clientId)).length).toBe(1)
    brandA = (await brandsOf(clientId))[0]!.id
    await expect(traffic.getByTestId(`client-brand-${brandA}`)).toContainText(BRAND_A)
    await expect(traffic.getByTestId('client-brand-name')).toHaveValue('')
    await traffic.getByTestId('client-brand-name').fill(BRAND_B)
    await traffic.getByTestId('client-brand-add').click()
    await expect.poll(async () => (await brandsOf(clientId)).length).toBe(2)
    const brandB = (await brandsOf(clientId)).find((b) => b.name === BRAND_B)!.id
    await expect(traffic.getByTestId(`client-brand-${brandB}`)).toContainText(BRAND_B)

    await traffic.getByTestId(`client-brand-edit-${brandA}`).click()
    await expect(traffic.getByTestId(`client-brand-edit-name-${brandA}`)).toHaveValue(BRAND_A)
    await expect(traffic.getByTestId(`client-brand-edit-short-${brandA}`)).toHaveValue('CBA')
    await traffic.getByTestId(`client-brand-edit-name-${brandA}`).fill(`${BRAND_A} renamed`)
    await traffic.getByTestId(`client-brand-edit-short-${brandA}`).fill('CBR')
    await traffic.getByTestId(`client-brand-save-${brandA}`).click()
    await expect(traffic.getByTestId(`client-brand-edit-name-${brandA}`)).toHaveCount(0)
    await expect(traffic.getByTestId(`client-brand-${brandA}`)).toContainText(`${BRAND_A} renamed`)
    await expect(traffic.getByTestId(`client-brand-${brandA}`)).toContainText('CBR')
    await expect.poll(async () => (await brandsOf(clientId)).find((b) => b.id === brandA)).toMatchObject({ name: `${BRAND_A} renamed`, short_name: 'CBR' })

    await traffic.getByTestId(`client-brand-edit-${brandB}`).click()
    await traffic.getByTestId(`client-brand-remove-${brandB}`).click() // arms
    await expect(traffic.getByTestId(`client-brand-${brandB}`)).toBeVisible()
    await traffic.getByTestId(`client-brand-remove-${brandB}`).click() // removes
    await expect(traffic.getByTestId(`client-brand-${brandB}`)).toHaveCount(0)
    await expect(traffic.getByTestId('client-brands-error')).toHaveCount(0)
    await expect.poll(async () => (await brandsOf(clientId)).map((b) => b.id)).toEqual([brandA])

    // Back → Basics, filled with what was saved; the stepper → Brands; Skip → People.
    await traffic.getByTestId('client-back').click()
    await expect(wizard).toHaveAttribute('data-step', '1')
    await expect(traffic).toHaveURL(/register\?step=1$/)
    await expect(traffic.getByTestId('client-name')).toHaveValue(NAME)
    await traffic.getByTestId('client-step-2').click()
    await expect(wizard).toHaveAttribute('data-step', '2')
    await expect(traffic.getByTestId(`client-brand-${brandA}`)).toBeVisible()
    await traffic.getByTestId('client-skip').click()
    await expect(wizard).toHaveAttribute('data-step', '3')
    await expect(traffic).toHaveURL(/register\?step=3$/)

    // People: one added (asks for work by default), switched to "signs off", renamed; a second removed.
    await traffic.getByTestId('client-contact-name').fill(CONTACT_A)
    await traffic.getByTestId('client-contact-role').fill('Head of marketing')
    await traffic.getByTestId('client-contact-add').click()
    await expect.poll(async () => (await contactsOf(clientId)).length).toBe(1)
    contactA = (await contactsOf(clientId))[0]!.id
    await expect(traffic.getByTestId(`client-contact-${contactA}`)).toContainText(CONTACT_A)
    await expect(traffic.getByTestId(`client-contact-${contactA}`)).toContainText('Head of marketing')
    const approver = traffic.getByTestId(`client-contact-approver-${contactA}`)
    await expect(approver).toHaveAttribute('aria-pressed', 'false')
    await approver.click()
    await expect(approver).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await contactsOf(clientId))[0]!.signs_off).toBe(true)

    await traffic.getByTestId(`client-contact-edit-${contactA}`).click()
    await expect(traffic.getByTestId(`client-contact-edit-name-${contactA}`)).toHaveValue(CONTACT_A)
    await traffic.getByTestId(`client-contact-edit-name-${contactA}`).fill(`${CONTACT_A} renamed`)
    await traffic.getByTestId(`client-contact-save-${contactA}`).click()
    await expect(traffic.getByTestId(`client-contact-edit-name-${contactA}`)).toHaveCount(0)
    await expect(traffic.getByTestId(`client-contact-${contactA}`)).toContainText(`${CONTACT_A} renamed`)
    await expect.poll(async () => (await contactsOf(clientId))[0]!.name).toBe(`${CONTACT_A} renamed`)

    await traffic.getByTestId('client-contact-name').fill(CONTACT_B)
    await traffic.getByTestId('client-contact-add').click()
    await expect.poll(async () => (await contactsOf(clientId)).length).toBe(2)
    const contactB = (await contactsOf(clientId)).find((c) => c.name === CONTACT_B)!.id
    await traffic.getByTestId(`client-contact-edit-${contactB}`).click()
    await traffic.getByTestId(`client-contact-remove-${contactB}`).click() // arms
    await traffic.getByTestId(`client-contact-remove-${contactB}`).click() // removes
    await expect(traffic.getByTestId(`client-contact-${contactB}`)).toHaveCount(0)
    await expect.poll(async () => (await contactsOf(clientId)).map((c) => c.id)).toEqual([contactA])

    // Skip → Dos and don'ts: two added, the first edited, the second removed.
    await traffic.getByTestId('client-skip').click()
    await expect(wizard).toHaveAttribute('data-step', '4')
    await traffic.getByTestId('client-rule-new-text').fill('Arabic leads.')
    await traffic.getByTestId('client-rule-add').click()
    await expect(traffic.getByTestId('client-rule-0')).toContainText('Arabic leads.')
    await traffic.getByTestId('client-rule-new-kind-dont').click()
    await traffic.getByTestId('client-rule-new-text').fill('Never say lottery.')
    await traffic.getByTestId('client-rule-add').click()
    await expect(traffic.getByTestId('client-rule-1')).toContainText('Never say lottery.')

    await traffic.getByTestId('client-rule-edit-0').click()
    await expect(traffic.getByTestId('client-rule-edit-text')).toHaveValue('Arabic leads.')
    await traffic.getByTestId('client-rule-edit-text').fill('Arabic leads; English follows.')
    await traffic.getByTestId('client-rule-save').click()
    await expect(traffic.getByTestId('client-rule-edit-text')).toHaveCount(0)
    await expect(traffic.getByTestId('client-rule-0')).toContainText('Arabic leads; English follows.')
    await expect.poll(async () => (await clientRow(clientId)).profile.rules?.map((r) => r.text)).toEqual(['Arabic leads; English follows.', 'Never say lottery.'])

    await traffic.getByTestId('client-rule-edit-1').click()
    await traffic.getByTestId('client-rule-remove').click() // arms
    await traffic.getByTestId('client-rule-remove').click() // removes
    await expect(traffic.getByTestId('client-rule-1')).toHaveCount(0)
    await expect.poll(async () => (await clientRow(clientId)).profile.rules?.map((r) => r.text)).toEqual(['Arabic leads; English follows.'])

    // Next → How we work → Review. Review's Edit opens that step; the stepper comes back; Back → How we work.
    await traffic.getByTestId('client-next').click()
    await expect(wizard).toHaveAttribute('data-step', '5')
    await traffic.getByTestId('client-next').click()
    await expect(wizard).toHaveAttribute('data-step', '6')
    await expect(traffic.getByTestId('client-review-people')).toContainText(`${CONTACT_A} renamed`)
    await traffic.getByTestId('client-review-edit-people').click()
    await expect(wizard).toHaveAttribute('data-step', '3')
    await expect(traffic.getByTestId(`client-contact-${contactA}`)).toBeVisible()
    await traffic.getByTestId('client-step-6').click()
    await expect(wizard).toHaveAttribute('data-step', '6')
    await traffic.getByTestId('client-review-edit-brands').click()
    await expect(wizard).toHaveAttribute('data-step', '2')
    await traffic.getByTestId('client-step-6').click()
    await expect(wizard).toHaveAttribute('data-step', '6')
    // Traffic is not the director: Review offers Ask, never Activate (ADR-0123 d.1).
    await expect(traffic.getByTestId('client-ask')).toBeVisible()
    await expect(traffic.getByTestId('client-activate')).toHaveCount(0)
    await traffic.getByTestId('client-back').click()
    await expect(wizard).toHaveAttribute('data-step', '5')

    expect((await clientRow(clientId)).activation_requested_at, 'nobody has asked yet').toBeNull()
    await traffic.context().close()
  })

  test('the duplicate check: a name already taken offers to open that client, or to carry on as a different one', async ({ browser }) => {
    const traffic = await as(browser, 'traffic')
    await traffic.goto('/clients/new')
    await traffic.getByTestId('client-name').fill(NAME)
    await expect(traffic.getByTestId('client-duplicate')).toBeVisible()
    await traffic.getByTestId('client-duplicate-open').click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}$`))
    await expect(traffic.getByTestId('client-page')).toBeVisible()

    await traffic.goto('/clients/new')
    await traffic.getByTestId('client-name').fill(NAME.toLocaleUpperCase())
    await expect(traffic.getByTestId('client-duplicate')).toBeVisible()
    await traffic.getByTestId('client-duplicate-different').click()
    await expect(traffic.getByTestId('client-duplicate')).toHaveCount(0)
    await expect(traffic).toHaveURL(/\/clients\/new$/)
    await expect(traffic.getByTestId('client-name')).toHaveValue(NAME.toLocaleUpperCase())
    await traffic.context().close()
  })

  test('the list: the tabs; a draft is continued and asked for; someone who only views clients is offered neither', async ({ browser }) => {
    const [northwind] = await rows<{ id: string }>('clients', `select=id&name=eq.${encodeURIComponent(CLIENTS.northwind)}`)
    expect(northwind, 'the seeded active client').toBeTruthy()

    const traffic = await as(browser, 'traffic')
    await traffic.goto('/clients')
    await expect(traffic.getByTestId('clients-tab-active')).toHaveAttribute('aria-selected', 'true')
    await traffic.getByTestId('clients-tab-drafts').click()
    await expect(traffic).toHaveURL(/\/clients\?tab=drafts$/)
    await expect(traffic.getByTestId('clients-tab-drafts')).toHaveAttribute('aria-selected', 'true')
    await expect(traffic.getByTestId(`client-draft-${clientId}`)).toBeVisible()
    await expect(traffic.getByTestId(`client-row-${northwind!.id}`)).toHaveCount(0)
    await traffic.getByTestId('clients-tab-all').click()
    await expect(traffic).toHaveURL(/\/clients\?tab=all$/)
    await expect(traffic.getByTestId(`client-row-${northwind!.id}`)).toBeVisible()
    await expect(traffic.getByTestId(`client-draft-${clientId}`)).toBeVisible()
    await traffic.getByTestId('clients-tab-active').click()
    await expect(traffic).toHaveURL(/\/clients$/)
    await expect(traffic.getByTestId(`client-row-${northwind!.id}`)).toBeVisible()

    // Continue opens the first step still open — every step has something, so Review.
    await traffic.getByTestId('clients-tab-drafts').click()
    await expect(traffic.getByTestId(`client-draft-review-${clientId}`)).toHaveCount(0) // the director's, not Traffic's
    await traffic.getByTestId(`client-draft-continue-${clientId}`).click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}/register\\?step=6$`))
    await expect(traffic.getByTestId('client-wizard')).toHaveAttribute('data-step', '6')

    // Ask: the draft records the request (the directors are told by the database).
    await traffic.goto('/clients?tab=drafts')
    expect((await clientRow(clientId)).activation_requested_at).toBeNull()
    await traffic.getByTestId(`client-draft-ask-${clientId}`).click()
    await expect.poll(async () => (await clientRow(clientId)).activation_requested_at).not.toBeNull()
    await expect(traffic.getByTestId(`client-draft-ask-${clientId}`)).toBeEnabled()

    // The draft's page: Continue opens Basics for someone who is not the director.
    await traffic.goto(`/clients/${clientId}`)
    await expect(traffic.getByTestId('client-status')).toBeVisible()
    await traffic.getByTestId('client-continue').click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}/register\\?step=1$`))
    await expect(traffic.getByTestId('client-wizard')).toHaveAttribute('data-step', '1')
    await traffic.context().close()

    // The department lead views clients and manages none: the draft is listed, nothing offered on it.
    const lead = await as(browser, 'lead')
    await lead.goto('/clients?tab=drafts')
    await expect(lead.getByTestId(`client-draft-${clientId}`)).toBeVisible()
    await expect(lead.getByTestId(`client-draft-continue-${clientId}`)).toHaveCount(0)
    await expect(lead.getByTestId(`client-draft-ask-${clientId}`)).toHaveCount(0)
    await expect(lead.getByTestId(`client-draft-review-${clientId}`)).toHaveCount(0)
    await lead.goto(`/clients/${clientId}`)
    await expect(lead.getByTestId('client-page')).toBeVisible()
    await expect(lead.getByTestId('client-continue')).toHaveCount(0)
    await lead.context().close()
  })

  test('the account director reviews the asked-for draft from the list and activates it; Ask is not his', async ({ browser }) => {
    const ad = await as(browser, 'ad')
    await ad.goto('/clients?tab=drafts')
    await expect(ad.getByTestId(`client-draft-${clientId}`)).toBeVisible()
    await expect(ad.getByTestId(`client-draft-ask-${clientId}`)).toHaveCount(0)
    await ad.getByTestId(`client-draft-review-${clientId}`).click()
    await expect(ad).toHaveURL(new RegExp(`/clients/${clientId}/register\\?step=6$`))
    await ad.getByTestId('client-activate').click()
    await expect(ad).toHaveURL(new RegExp(`/clients/${clientId}$`))
    await expect.poll(async () => (await clientRow(clientId)).status).toBe('active')
    await expect(ad.getByTestId('client-continue')).toHaveCount(0)
    await ad.context().close()
  })

  test('the active client’s page: its row opens it; every tab; Add brand, a brand tile, the Library, New job; rules locked to all but the director', async ({ browser }) => {
    test.setTimeout(120_000)
    const traffic = await as(browser, 'traffic')
    await traffic.goto('/clients?tab=all')
    await traffic.getByTestId(`client-row-${clientId}`).click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}$`))
    await expect(traffic.getByTestId('client-page')).toBeVisible()
    await expect(traffic.getByTestId('client-tab-overview')).toHaveAttribute('aria-selected', 'true')

    const tabs: [string, string][] = [
      ['campaigns', 'client-campaigns'],
      ['brands', 'client-brands'],
      ['people', 'client-people'],
      ['rules', 'client-rules'],
      ['library', 'client-library'],
    ]
    for (const [tab, panel] of tabs) {
      await traffic.getByTestId(`client-tab-${tab}`).click()
      await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}\\?tab=${tab}$`))
      await expect(traffic.getByTestId(`client-tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
      await expect(traffic.getByTestId(panel)).toBeVisible()
    }
    // On the Brands tab the saved brand is there, on People the saved person.
    await traffic.getByTestId('client-tab-brands').click()
    await expect(traffic.getByTestId(`client-brand-${brandA}`)).toContainText(`${BRAND_A} renamed`)
    await traffic.getByTestId('client-tab-people').click()
    await expect(traffic.getByTestId(`client-contact-${contactA}`)).toContainText(`${CONTACT_A} renamed`)
    // Rules on an active client are locked for Traffic (ADR-0123 d.5): no Edit on them, no add.
    await traffic.getByTestId('client-tab-rules').click()
    await expect(traffic.getByTestId('client-rules-locked')).toBeVisible()
    await expect(traffic.getByTestId('client-rule-0')).toContainText('Arabic leads; English follows.')
    await expect(traffic.getByTestId('client-rule-edit-0')).toHaveCount(0)
    await expect(traffic.getByTestId('client-rule-add')).toHaveCount(0)

    // Library tab → Open the library, on this client.
    await traffic.getByTestId('client-tab-library').click()
    await traffic.getByTestId('client-open-library').click()
    await expect(traffic).toHaveURL(new RegExp(`/library\\?client=${clientId}$`))
    await expect(traffic.getByTestId(`library-client-${clientId}`)).toHaveAttribute('aria-current', 'true')

    // Overview: Add brand opens the Brands tab; a brand tile opens the Library on the client.
    await traffic.goto(`/clients/${clientId}?tab=people`)
    await traffic.getByTestId('client-tab-overview').click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}$`))
    await expect(traffic.getByTestId('client-live')).toBeVisible()
    await traffic.getByTestId('client-add-brand').click()
    await expect(traffic).toHaveURL(new RegExp(`/clients/${clientId}\\?tab=brands$`))
    await expect(traffic.getByTestId('client-brand-name')).toBeVisible()
    await traffic.getByTestId('client-tab-overview').click()
    await expect(traffic.getByTestId(`client-brand-tile-${brandA}`)).toContainText(`${BRAND_A} renamed`)
    await traffic.getByTestId(`client-brand-tile-${brandA}`).click()
    await expect(traffic).toHaveURL(new RegExp(`/library\\?client=${clientId}$`))
    await expect(traffic.getByTestId(`library-client-${clientId}`)).toHaveAttribute('aria-current', 'true')

    // New job for this client: the single-job wizard opens with the client chosen.
    await traffic.goto(`/clients/${clientId}`)
    await traffic.getByTestId('client-new-job').click()
    await expect(traffic).toHaveURL(new RegExp(`/campaigns/new-job\\?client=${clientId}$`))
    await expect(traffic.getByTestId('sj-client')).toHaveValue(clientId)
    await traffic.context().close()

    // The director may change an active client's rules: Edit opens the rule, Save writes it.
    const ad = await as(browser, 'ad')
    await ad.goto(`/clients/${clientId}?tab=rules`)
    await ad.getByTestId('client-rule-edit-0').click()
    await ad.getByTestId('client-rule-edit-text').fill('Arabic leads; English follows. (director)')
    await ad.getByTestId('client-rule-save').click()
    await expect(ad.getByTestId('client-rule-0')).toContainText('(director)')
    await expect.poll(async () => (await clientRow(clientId)).profile.rules?.map((r) => r.text)).toEqual(['Arabic leads; English follows. (director)'])
    await ad.context().close()

    // The department lead views the page and is offered no editor on it.
    const lead = await as(browser, 'lead')
    await lead.goto(`/clients/${clientId}`)
    await expect(lead.getByTestId('client-page')).toBeVisible()
    await expect(lead.getByTestId(`client-brand-tile-${brandA}`)).toBeVisible()
    await expect(lead.getByTestId('client-add-brand')).toHaveCount(0)
    await expect(lead.getByTestId('client-edit')).toHaveCount(0)
    await lead.getByTestId('client-tab-brands').click()
    await expect(lead.getByTestId(`client-brand-${brandA}`)).toBeVisible()
    await expect(lead.getByTestId(`client-brand-edit-${brandA}`)).toHaveCount(0)
    await expect(lead.getByTestId('client-brand-add')).toHaveCount(0)
    await lead.getByTestId('client-tab-people').click()
    await expect(lead.getByTestId(`client-contact-${contactA}`)).toBeVisible()
    await expect(lead.getByTestId(`client-contact-approver-${contactA}`)).toBeDisabled()
    await expect(lead.getByTestId(`client-contact-edit-${contactA}`)).toHaveCount(0)
    await expect(lead.getByTestId('client-contact-add')).toHaveCount(0)
    await lead.context().close()

    // A team member holds no client permission: the page is not theirs, New job is never offered.
    const maker = await as(browser, 'maker')
    await maker.goto(`/clients/${clientId}`)
    await expect(maker).not.toHaveURL(/\/clients\//)
    await expect(maker.getByTestId('client-page')).toHaveCount(0)
    await expect(maker.getByTestId('client-new-job')).toHaveCount(0)
    await maker.context().close()
  })
})
