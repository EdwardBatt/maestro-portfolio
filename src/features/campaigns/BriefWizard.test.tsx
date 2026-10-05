import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../../lib/i18n'
// The pure half of the folder tree, which imports nothing — safe inside a mock factory.
import { viewOf } from '../../lib/assets/folder-tree'

// Drives the mocked mutation's pending flag so the busy affordance can be rendered.
// Reset in beforeEach — a test that sets it must not leak into the next.
let ingestPending = false
let proposePending = false

const submitMutate = vi.fn()

const refData = vi.hoisted(() => ({
  data: {
    clients: [{ id: 'c1', name: 'Zeta', accountManagerId: 'u2' }],
    brands: [{ id: 'b1', name: 'Zeta KW', clientId: 'c1' }],
  },
  isLoading: false,
  isError: false,
  // I35.3: registering a brand refetches the picker so the new one is selectable at once.
  refetch: vi.fn(),
}))

// ADR-0067: the wizard creates a DRAFT campaign on leaving step 1 and completes it at submit.
// `startDraftMutate` resolves with an id by default, so every existing test that walks past
// step 1 keeps walking; a test that wants the failure path overrides it.
const startDraftMutate = vi.hoisted(() =>
  vi.fn((_args, opts) => opts?.onSuccess?.('draft-1')),
)
const updateDraftMutate = vi.hoisted(() => vi.fn((_args, opts) => opts?.onSuccess?.()))
const draftQuery = vi.hoisted(() => ({ data: null as unknown, isSuccess: true }))
// I40: who will accept each department's brief, keyed by department. The wizard passes the DRAFT
// id, so this is empty until step 1 has been left — which is also true in the product.
const departmentApprovers = vi.hoisted(() => ({
  value: new Map<string, { name: string; isAssignedOwner: boolean }[]>(),
}))

// Self-contained factory (the real module reaches lib/env, which throws in CI).
// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
}))
vi.mock('./api/campaign-api', () => ({
  useWizardRefData: () => refData,
  useStartCampaignDraft: () => ({ mutate: startDraftMutate, isPending: false }),
  useUpdateCampaignDraft: () => ({ mutate: updateDraftMutate, isPending: false }),
  useCompleteCampaignDraft: () => ({ mutate: submitMutate, isPending: false }),
  useCampaignDraft: () => draftQuery,
}))

// Same reason, and the reason `traps.md` records: brief-ingest-api reaches lib/supabase →
// lib/env, which Zod-parses import.meta.env at import time and throws when the VITE_ vars
// are absent. They are absent in CI. The panel's own behaviour is driven through this stub.
const ingestMutate = vi.hoisted(() => vi.fn())
vi.mock('./api/brief-ingest-api', () => ({
  BriefTooLongError: class BriefTooLongError extends Error {
    code = 'too_long'
  },
  BriefIngestRefusedError: class BriefIngestRefusedError extends Error {
    code = 'forbidden'
  },
  useIngestBrief: () => ({ mutateAsync: ingestMutate, isPending: ingestPending }),
}))

// Same reason again (lib/supabase → lib/env). ADR-0048 d.4's proposals are driven through
// this stub; `proposePending` lets the busy note be rendered.
const proposeMutate = vi.hoisted(() => vi.fn())
/** ADR-0054: the hook returns the rows AND what happened to the tenant's vocabulary, so the
 *  wizard can tell "no type fitted" from "there were no types to offer". */
const proposal = (
  rows: Record<string, unknown>[],
  vocabulary: Record<string, string> = { types: 'offered', channels: 'offered' },
  // ADR-0101: the real answer always carries its groups. With none given, the rows sit in one group,
  // as the model always places them (ADR-0116 d.3); a row that says `group: null` stays ungrouped.
  groups?: Record<string, unknown>[],
) =>
  groups
    ? { rows, vocabulary, groups }
    : {
        rows: rows.map((r) => ('group' in r ? r : { ...r, group: 0 })),
        vocabulary,
        groups: [{ name: 'Main work', departmentId: 'dep-av' }],
      }
vi.mock('./api/deliverables-generate-api', () => ({
  // Carries its code the way the real one does, so `instanceof` and the message lookup in the
  // wizard are both exercised rather than stubbed past.
  DeliverablesRefusedError: class DeliverablesRefusedError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
  useGenerateDeliverables: () => ({ mutateAsync: proposeMutate, isPending: proposePending }),
}))

// ADR-0050 d.1: the wizard asks for an OWNER per deliverable, so it reads the assignable
// people and the departments they sit in. Both reach lib/supabase → lib/env, hence the stubs.
// ADR-0101 d.8: who may own a workstream — a department lead and a team lead, in two departments.
vi.mock('./api/workstreams-api', () => ({
  useWorkstreamOwnerCandidates: () => ({
    data: [
      { id: 'l1', name: 'Hana', departmentId: 'dep-av', role: 'department_lead' },
      { id: 'l2', name: 'Omar', departmentId: 'dep-content', role: 'team_lead' },
    ],
  }),
}))
// I73.4: the account manager box offers the account managers — Lina (the client's) and Sara — never the leads.
vi.mock('../clients/api/clients-api', () => ({
  useAccountManagers: () => ({ data: [{ id: 'u2', name: 'Lina' }, { id: 'am-sara', name: 'Sara' }] }),
}))
vi.mock('../deliverables/api/deliverables-api', () => ({
  // ADR-0083 d.9: the wizard offers LEADS as owners; both fixtures are department leads.
  useDeliverableOwnerCandidates: () => ({
    data: [
      { id: 'u1', name: 'Ahmed', departmentId: 'dep-av', teamId: null },
      { id: 'u2', name: 'Lina', departmentId: 'dep-content', teamId: null },
    ],
  }),
}))
// ADR-0051 I18.5: step 3 reads the tenant's OWN taxonomy. Two categories and three types are
// enough to prove the cascade — picking a category narrows the type list — without turning the
// fixture into a copy of the 240-row seed.
vi.mock('../admin/api/deliverable-types-api', () => ({
  useDeliverableCategories: () => ({
    data: [
      { id: 'c-soc', code: 'SOC', nameEn: 'Social Media', nameAr: null, sortOrder: 10, isActive: true },
      { id: 'c-vid', code: 'VID', nameEn: 'Video & Motion', nameAr: null, sortOrder: 20, isActive: true },
    ],
    isError: false,
  }),
  useDeliverableTypes: () => ({
    data: [
      { id: 't-soc-004', code: 'SOC-004', categoryCode: 'SOC', nameEn: 'Reel', nameAr: null, isActive: true, leadTimeHours: null, defaultLoadPct: null, revisionLimit: null, defaultWorkflowTemplateId: 'tpl-reel' },
      { id: 't-vid-008', code: 'VID-008', categoryCode: 'VID', nameEn: 'Reel', nameAr: null, isActive: true, leadTimeHours: null, defaultLoadPct: null, revisionLimit: null, defaultWorkflowTemplateId: 'tpl-reel' },
      { id: 't-vid-001', code: 'VID-001', categoryCode: 'VID', nameEn: 'TVC', nameAr: null, isActive: true, leadTimeHours: null, defaultLoadPct: null, revisionLimit: null, defaultWorkflowTemplateId: null },
    ],
    isError: false,
  }),
  // ADR-0117 d.3: adding a language the list lacks — resolves to a code made from the name.
  useAddLanguage: () => ({ mutateAsync: async (label: string) => label.toLowerCase(), isPending: false }),
  useAttributeValues: () => ({
    data: [
      { id: 'a-ig', attribute: 'channel', code: 'INSTAGRAM', labelEn: 'Instagram', labelAr: null, sortOrder: 10, isActive: true },
      { id: 'a-mp4', attribute: 'format', code: 'MP4', labelEn: 'MP4', labelAr: null, sortOrder: 10, isActive: true },
      { id: 'a-ar', attribute: 'language', code: 'ar', labelEn: 'Arabic', labelAr: 'العربية', sortOrder: 10, isActive: true },
    ],
    isError: false,
  }),
  // ADR-0097 d.7: the catalogue as the picker reads it — the same three types, grouped.
  useDeliverableCatalogue: () => ({
    items: [
      { id: 't-soc-004', code: 'SOC-004', name: 'Reel', category: 'Social Media', categoryOrder: 10 },
      { id: 't-vid-008', code: 'VID-008', name: 'Reel', category: 'Video & Motion', categoryOrder: 20 },
      { id: 't-vid-001', code: 'VID-001', name: 'TVC', category: 'Video & Motion', categoryOrder: 20 },
    ],
    isLoading: false,
    isError: false,
  }),
}))

// Edward, 22 Sep: the tasks a proposed row WILL produce, previewed from the template's steps.
vi.mock('../admin/api/workflow-templates-api', () => ({
  useWorkflowSteps: () => ({
    data: [
      { id: 's1', templateId: 'tpl-reel', sortOrder: 10, titleEn: 'Script', titleAr: null, defaultHours: null, reviewMode: 'digital', repeatsPerUnit: false, isActive: true },
      { id: 's2', templateId: 'tpl-reel', sortOrder: 20, titleEn: 'Create Reel', titleAr: null, defaultHours: null, reviewMode: 'digital', repeatsPerUnit: true, isActive: true },
    ],
    isLoading: false,
    isError: false,
  }),
}))

// I35.2/I35.3: step 1 now files brand documents and can register a brand. Both reach
// lib/supabase → lib/env (traps.md), and the wizard reads a grant it did not read before.
const brandFolders = vi.hoisted(() => ({
  data: [
    { id: 'f-brand', clientId: 'c1', parentId: 'f-broot', name: 'Zeta KW', kind: 'brand', isSystem: true, brandId: 'b1', campaignId: null },
    { id: 'f-logos', clientId: 'c1', parentId: 'f-brand', name: 'Logos', kind: 'asset_type', isSystem: true, brandId: 'b1', campaignId: null },
    { id: 'f-camp', clientId: 'c1', parentId: 'f-proj', name: 'Ramadan', kind: 'campaign', isSystem: true, brandId: null, campaignId: 'draft-1' },
    { id: 'f-refs', clientId: 'c1', parentId: 'f-camp', name: 'References', kind: 'asset_type', isSystem: true, brandId: null, campaignId: 'draft-1' },
  ],
}))
const createBrandMutate = vi.hoisted(() => vi.fn())
const canFile = vi.hoisted(() => ({ value: true }))
/** `campaign_budget:view` (I56.18). On by default so the brief shows all fourteen fields. */
const canSeeBudget = vi.hoisted(() => ({ value: true }))

vi.mock('../../lib/assets/folders', () => ({
  // I49.77: the roots are asked for by brand / campaign, and each filing panel reads its own
  // level; the mocks serve both from the one fixture.
  useBrandFolderRoot: (brandId: string | null) => ({
    data: brandId ? brandFolders.data.find((f) => f.kind === 'brand' && f.brandId === brandId) ?? null : undefined,
  }),
  useCampaignFolderRoot: (campaignId: string | null) => ({
    data: campaignId ? brandFolders.data.find((f) => f.kind === 'campaign' && f.campaignId === campaignId) ?? null : undefined,
  }),
  useFolderView: (clientId: string | null, folderId: string | null) => ({
    data: clientId ? viewOf(brandFolders.data, folderId) : undefined,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
  useCreateFolder: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateFolders: () => vi.fn(),
  isDuplicateFolderName: (e: unknown) => (e as { code?: string } | null)?.code === '23505',
  breadcrumbWithin: (
    folders: { id: string; parentId: string | null }[],
    rootId: string,
    folderId: string,
  ) => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    const chain: typeof folders = []
    let cur = byId.get(folderId) ?? null
    while (cur) {
      chain.unshift(cur)
      if (cur.id === rootId) return chain
      cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
    }
    return []
  },
}))

vi.mock('../../lib/calendar/office-calendars-api', () => ({
  usePlanningCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, office: null, isLoading: false }),
}))
// The timing step's capacity column reads the department's week (Q14). An empty schedule here:
// the load line itself is `DepartmentWeekLoad`'s to test, not the wizard's.
vi.mock('../team/api/team-api', () => ({
  useTeamLoad: () => ({ week: { start: '', end: '', label: '' }, groups: [], isLoading: false, isError: false }),
  capacityLevel: () => 'ok',
}))
vi.mock('../../lib/settings/scheduling-settings-api', () => ({
  DEFAULT_SCHEDULING_SETTINGS: { rule: { deliveryDaysBeforeGoLive: 2, commenceDaysBeforeDelivery: 4 }, reviewBufferWorkingDays: 1 },
  useSchedulingSettings: () => ({ data: undefined, isLoading: false }),
}))
// ADR-0045 d.3: how long unassigned work sits before it is chased. The review step says it
// out loud, so the wizard reads the tenant's setting rather than a constant.
// ADR-0111 (I59.27): the tenant's own filler words — none here; the built-ins still warn.
vi.mock('../../lib/brief/filler-words-api', () => ({ useFillerWordList: () => [] }))
vi.mock('../../lib/settings/reminder-settings-api', () => ({
  DEFAULT_REMINDER_SETTINGS: { briefApprovalHours: 24, assignmentEscalationHours: 24 },
  useReminderSettings: () => ({ data: { briefApprovalHours: 24, assignmentEscalationHours: 24 } }),
}))
vi.mock('../../lib/brands', () => ({
  useCreateBrand: () => ({ mutate: createBrandMutate, isPending: false }),
  isDuplicateBrandName: (e: unknown) => (e as { code?: string } | null)?.code === '23505',
}))

const fileDocumentsMutate = vi.hoisted(() => vi.fn())
const fileDocumentsAsync = vi.hoisted(() => vi.fn(async () => [{ name: 'shot.png', ok: true, assetId: 'a-1' }]))
vi.mock('./api/document-filing-api', () => ({
  useFileDocuments: () => ({ mutate: fileDocumentsMutate, mutateAsync: fileDocumentsAsync, isPending: false }),
  fetchCampaignReferencesFolder: vi.fn(async () => 'f-refs'),
  useCampaignReferencesFolder: (campaignId: string | null) => ({ data: campaignId ? 'f-refs' : undefined }),
  receiptFile: (image: File) => image,
}))

// ADR-0066: step 1 collects evidence that the brief was asked for. Both hooks reach
// lib/supabase → lib/env (traps.md); the panel behaviour is driven through these stubs.
const readReceiptMutate = vi.hoisted(() => vi.fn())
const saveReceiptAsync = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./api/brief-receipt-api', () => ({
  ReceiptReadRefusedError: class ReceiptReadRefusedError extends Error {
    code = 'forbidden'
  },
  useReadBriefReceipt: () => ({ mutate: readReceiptMutate, isPending: false }),
  // I40: step 1 reads back the receipt already recorded, so a resumed draft shows the screenshot
  // it filed rather than an empty picker. Nothing saved in this fixture.
  useBriefReceipt: () => ({ data: null }),
  useReceiptTimeZones: () => ({ data: { mine: 'Asia/Dubai', options: ['Asia/Dubai', 'Europe/London'] } }),
  useSaveBriefReceipt: () => ({ mutateAsync: saveReceiptAsync, isPending: false }),
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({
    can: (k: string) => (k === 'assets:manage' ? canFile.value : k === 'campaign_budget:view' ? canSeeBudget.value : true),
  }),
}))

// DocumentFiling stamps the tenant and uploader onto each asset row from the session.
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'u1' } } }),
}))

// I16.2: the brief type is asked for on step 1 and decides which template every department brief
// is written against. The api reaches lib/env, which throws where no VITE_* exists — traps.md.
vi.mock('../admin/api/brief-templates-api', () => ({
  useBriefTemplates: () => ({
    data: [
      { id: 'bt1', briefType: 'campaign', fields: [{ key: 'objective', en: 'Objective' }], isActive: true },
      { id: 'bt2', briefType: 'social', fields: [], isActive: true },
    ],
    isLoading: false,
  }),
}))

// ADR-0071 d.1/d.2 — the wizard now sorts the type picker by what the owner's department's briefs
// order. Both hooks are stubbed EMPTY here on purpose: with no mapping the picker must fall back to
// the plain, complete list, which is what every assertion in this file already checks. The sorted
// path has its own coverage.
vi.mock('./api/brief-deliverable-types-api', () => ({
  useBriefDeliverableTypes: () => ({ data: new Map<string, Set<string>>() }),
}))
vi.mock('./api/department-templates-api', () => ({
  useDepartmentTemplates: () => ({ data: new Map() }),
  useAllBriefTemplates: () => ({ data: [] }),
}))

// The wizard opens a filed source document through the Library's signed-URL helper. It was the one
// import in this file's graph nobody stubbed, so the real module loaded — and it reaches
// `lib/supabase` -> `lib/env`, which Zod-parses `import.meta.env` at import time and THROWS where no
// VITE_ vars exist. That is CI, and it failed the whole file with "0 test" rather than a named
// assertion (docs/memory/traps.md).
vi.mock('../library/api/library-api', () => ({
  fetchAssetDownloadUrl: vi.fn(async () => 'https://example.test/signed'),
}))

// I40: step 5 both creates and approves when the signed-in person IS the campaign's account
// manager (ADR-0048 d.9). Stubbed rather than provided, like every other mutation in this file.
const approveMutate = vi.fn()
// ADR-0070 d.2 — who can accept each department's brief, by name. Empty here: this fixture has no
// leads, and every assertion in this file is about the wizard rather than about who approves.
vi.mock('./api/brief-approval-api', () => ({
  useDepartmentApprovers: () => ({ data: departmentApprovers.value }),
}))

vi.mock('./api/campaign-detail-api', () => ({
  useApproveCampaign: () => ({ mutate: approveMutate, isPending: false }),
}))
// Not the account manager in this fixture, so the last button creates and stops — which is what
// every assertion below already expects.
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'someone-else' } } }),
}))

vi.mock('../admin/api/admin-api', () => ({
  useDepartments: () => ({
    data: [
      { id: 'dep-av', name: 'Art & Video' },
      { id: 'dep-content', name: 'Copy, Social & Content' },
    ],
  }),
}))

import { BriefWizard } from './BriefWizard'
import { DeliverablesRefusedError } from './api/deliverables-generate-api'

function renderWizard() {
  return render(
    <MemoryRouter>
      <BriefWizard />
    </MemoryRouter>,
  )
}

function q(selector: string): HTMLElement {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`not found: ${selector}`)
  return el as HTMLElement
}

/**
 * The work screen replaced the deliverables table (`CB-v3-03`, 24 Sep), so the controls these
 * tests drive have moved. A row is now a line under a workstream; everything that used to be a
 * cell — the owner, the type, the quantity, the phase — is in the piece dialog behind Edit.
 *
 * These helpers keep the tests saying what they always said. Where an assertion now needs the
 * dialog open to see the thing it is about, that IS the behaviour change, and the test says so.
 */

/** The first piece on the work screen. Proposals arrive ungrouped, which is where they show. */
function pieceId(): string {
  return q('[data-testid^="wizard-work-piece-"]')
    .getAttribute('data-testid')!
    .replace('wizard-work-piece-', '')
}

/** The inline line on the first group — the add control on the work screen. Since ADR-0116 (27 Sep)
 *  every campaign piece is in a workstream and there is no ungrouped line to type into, so with no
 *  group yet this makes one first, the way a person has to. */
const ADD_LINE = '[data-testid^="wizard-work-new-"]:not([data-testid="wizard-work-new-group"])'
function addLine(): HTMLElement {
  if (!document.querySelector(ADD_LINE)) {
    fireEvent.click(screen.getByTestId('wizard-work-new-group'))
    fireEvent.change(screen.getByTestId('wizard-new-workstream-name'), { target: { value: 'Main work' } })
    fireEvent.click(q('[data-testid^="wizard-new-workstream-dept-"]'))
    fireEvent.click(screen.getByTestId('wizard-new-workstream-create'))
  }
  return q(ADD_LINE)
}

/** Type one piece into the first group and commit it, the way Enter does on the frame. */
/**
 * Step 4's one row action (`I56.11`, Edward 24 Sep): Edit, type the date, Save. The timing step has
 * no date field on the row any more — a date is given in the piece's dialog, where it also chooses
 * the phase.
 */
function setDue(date: string, id?: string) {
  fireEvent.click(id ? screen.getByTestId(`wizard-timing-edit-${id}`) : q('[data-testid^="wizard-timing-edit-"]'))
  fireEvent.change(screen.getByTestId('wizard-timing-piece-due'), { target: { value: date } })
  fireEvent.click(screen.getByTestId('wizard-timing-piece-save'))
}
const dueText = () => q('[data-testid^="wizard-timing-due-"]').textContent
const startText = () => q('[data-testid^="wizard-timing-starts-"]').textContent

function typePiece(name: string) {
  const line = addLine()
  fireEvent.change(line, { target: { value: name } })
  fireEvent.keyDown(line, { key: 'Enter' })
}

function openPiece(id: string) {
  fireEvent.click(screen.getByTestId(`wizard-work-edit-${id}`))
}

function pieceField(name: string): HTMLElement {
  return screen.getByTestId(`wizard-piece-${name}`)
}

function setPieceField(name: string, value: string) {
  fireEvent.change(pieceField(name), { target: { value } })
}

function savePiece() {
  fireEvent.click(screen.getByTestId('wizard-piece-save'))
}

/** Name the owner on a piece — one dialog trip, because that is where the field lives now. */
function setOwner(id: string) {
  openPiece(id)
  setPieceField('owner', 'u1')
  savePiece()
}

/** ADR-0117 addendum (Q19, 4 Oct): step 2 will not pass without a language — picked, never assumed. */
function chooseLanguage(code = 'ar') {
  if (screen.queryByTestId(`wizard-languages-picker-chip-${code}`)) return
  fireEvent.change(screen.getByTestId('wizard-languages-picker-input'), { target: { value: 'Ara' } })
  fireEvent.mouseDown(screen.getByTestId(`wizard-languages-picker-option-${code}`))
}

describe('BriefWizard (ADR-0020, frames 21.1–21.5)', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    approveMutate.mockReset()
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    proposePending = false
    // Restored here rather than inherited: leaving a step SAVES the draft and only advances
    // in the callback, so a suite that runs after one which reset this mock would sit on
    // the step for ever with no error to show for it.
    startDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.('draft-1'))
    updateDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.())
  })

  it('blocks advancing past Job Type until client and name are set', () => {
    renderWizard()
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toBeInTheDocument()
    // still on step 1
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument()
  })

  it('walks all five steps and submits the campaign→streams→deliverables payload', async () => {
    renderWizard()

    // Step 1 — Job Type
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))

    // Step 2 — Strategy (proposition required)
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'The network that keeps Ramadan connected.' },
    })
    chooseLanguage()
    fireEvent.change(screen.getByTestId('wizard-brief-audiencePrimary'), {
      target: { value: 'Young families' },
    })
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })

    // Step 3 — The work. Phases are no longer a step: they sit on step 1 (CB-v3-01), off by
    // default, so nothing here has to pass through them.
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    typePiece('Hero film — 30s')
    // The owner lives in the piece dialog now, so naming one is a trip through it.
    setOwner(pieceId())
    fireEvent.click(screen.getByTestId('wizard-next'))

    // Step 5 — Timing (due date required)
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()
    setDue('2026-02-20')
    fireEvent.click(screen.getByTestId('wizard-next'))

    // Step 5 — CB-v3-05. The per-department brief tabs went with the old review step: the
    // account manager approves the CAMPAIGN, and each department then generates and approves
    // its own brief (ADR-0100). What this step owes is the campaign, grouped by workstream.
    expect(screen.getByTestId('wizard-step-5')).toBeInTheDocument()
    // Grouped by workstream now, with the loose work gathered rather than dropped — the
    // department is on the group, which is what sets it (ADR-0099 d.3).
    expect(screen.getAllByTestId(/^wizard-review-row-/)[0]!).toHaveTextContent('Art & Video')

    // I40 + ADR-0072 d.8: step 5 IS the approval step and there is no create-without-approving
    // path out of the wizard — a campaign left unapproved here would have nowhere to be approved
    // once the separate page goes. One button, one behaviour.
    expect(screen.getByTestId('wizard-review-approve')).toHaveTextContent(/approve and start the work/i)

    fireEvent.click(screen.getByTestId('wizard-review-approve'))

    // ADR-0067: the campaign's IDENTITY was written on leaving step 1, as a draft; submit
    // carries only its CONTENT. Both halves are asserted, because a split that dropped one of
    // them would still produce a campaign — just an empty or an anonymous one.
    expect(startDraftMutate).toHaveBeenCalledTimes(1)
    expect(startDraftMutate.mock.calls[0][0]).toMatchObject({
      clientId: 'c1',
      name: 'Zeta Ramadan',
    })

    expect(submitMutate).toHaveBeenCalledTimes(1)
    const payload = submitMutate.mock.calls[0][0]
    expect(payload.campaignId).toBe('draft-1')
    expect(payload.strategy.proposition).toContain('Ramadan')
    expect(payload.deliverables).toHaveLength(1)
    expect(payload.deliverables[0]).toMatchObject({
      name: 'Hero film — 30s',
      ownerUserId: 'u1',
      // Fri 20 Feb was typed; nobody works a Friday, so the row showed Thu 19 Feb — and what the
      // row showed is what goes up.
      dueAt: '2026-02-19',
    })
  })
})

// ADR-0044 "Testing", UI half: filled fields are marked, user-typed fields survive an
// ingest, and a failed call falls back to the heuristic and says so.
describe('BriefWizard — brief ingestion (ADR-0044)', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    ingestMutate.mockReset()
    ingestMutate.mockResolvedValue({ fields: {}, oversized: [], source: 'model' })
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    ingestPending = false
    proposePending = false
  })

  /** Get to the Strategy step, where the ingest panel lives. */
  function toStrategyStep() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
  }

  /** Paste text and run the ingest, resolving with whatever the stub is set to return. */
  async function pasteAndIngest(text = 'Background\nAnything.') {
    fireEvent.click(screen.getByTestId('brief-ingest-toggle-mode'))
    fireEvent.change(screen.getByTestId('brief-ingest-paste'), { target: { value: text } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('brief-ingest-run'))
    })
  }

  it('shows the shared busy spinner while the model is being called', () => {
    // A model call takes seconds and the wizard has no other sign it is working — the exact
    // dead-click problem Button exists for. Asserting the SHARED component rather than a
    // bespoke element is the point: one affordance everywhere (AGENTS.md §4).
    ingestPending = true
    toStrategyStep()

    // The drop zone reads a file the moment it is chosen, so there is no Read button to spin:
    // the shared busy dialog is the sign, and the choose button waits.
    expect(screen.getByTestId('brief-ingest-busy')).toBeInTheDocument()
    expect(screen.getByTestId('brief-ingest-choose')).toBeDisabled()
  })

  it('fills empty fields, marks each one, and states the count', async () => {
    ingestMutate.mockResolvedValue({
      oversized: [],
      source: 'model',
      fields: { background: 'Quiet since Eid.', insight: 'Effort, not spend.' },
    })
    toStrategyStep()
    await pasteAndIngest()

    expect(screen.getByTestId('wizard-brief-background')).toHaveValue('Quiet since Eid.')
    expect(screen.getByTestId('wizard-brief-insight')).toHaveValue('Effort, not spend.')
    expect(screen.getByTestId('wizard-brief-background-suggested')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-brief-insight-suggested')).toBeInTheDocument()
    expect(screen.getByTestId('brief-ingest-status')).toHaveTextContent('2')
    // A field the document said nothing about carries no marker.
    expect(screen.queryByTestId('wizard-brief-proposition-suggested')).not.toBeInTheDocument()
  })

  it('never overwrites a field the user typed, and says how many it left alone', async () => {
    ingestMutate.mockResolvedValue({
      oversized: [],
      source: 'model',
      fields: { background: 'The version from the document.', insight: 'Effort, not spend.' },
    })
    toStrategyStep()
    fireEvent.change(screen.getByTestId('wizard-brief-background'), {
      target: { value: 'What the account manager wrote.' },
    })
    await pasteAndIngest()

    expect(screen.getByTestId('wizard-brief-background')).toHaveValue(
      'What the account manager wrote.',
    )
    expect(screen.queryByTestId('wizard-brief-background-suggested')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-brief-insight')).toHaveValue('Effort, not spend.')
    expect(screen.getByTestId('brief-ingest-status').textContent).toContain('1 field you had')
  })

  it('says so when the call failed and the heading matcher answered instead', async () => {
    ingestMutate.mockResolvedValue({ source: 'fallback', oversized: [], fields: { insight: 'From headings.' } })
    toStrategyStep()
    await pasteAndIngest()

    const status = screen.getByTestId('brief-ingest-status')
    expect(status).toHaveTextContent('headings')
    // Said out loud, not whispered: the fallback notice is styled as a warning.
    expect(status.className).toContain('form-error')
  })

  it('drops the marker as soon as the user edits or confirms the field', async () => {
    ingestMutate.mockResolvedValue({ source: 'model', oversized: [], fields: { insight: 'a', task: 'b' } })
    toStrategyStep()
    await pasteAndIngest()

    fireEvent.change(screen.getByTestId('wizard-brief-insight'), { target: { value: 'mine' } })
    expect(screen.queryByTestId('wizard-brief-insight-suggested')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('wizard-brief-task-keep'))
    expect(screen.queryByTestId('wizard-brief-task-suggested')).not.toBeInTheDocument()
  })

  it('refuses a PDF with its own message and changes nothing', async () => {
    toStrategyStep()
    const pdf = new File(['%PDF-1.7'], 'brief.pdf', { type: 'application/pdf' })
    const input = screen.getByTestId('brief-ingest-file') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdf] } })
    })

    expect(screen.getByTestId('brief-ingest-error')).toHaveTextContent('PDF')
    expect(ingestMutate).not.toHaveBeenCalled()
  })

  // ADR-0044 §8 kept its promise by STAGING the document until submit, because the campaign's
  // folders did not exist before then. ADR-0067 d.6 removed the reason: the draft campaign is
  // created on leaving step 1, so by the time the ingest runs on step 2 the References folder is
  // real and the document is filed at once — like every other reference material.
  it('files the uploaded source document into References as soon as it is read', async () => {
    fileDocumentsMutate.mockReset()
    ingestMutate.mockResolvedValue({ source: 'model', oversized: [], fields: { proposition: 'Say this.' } })
    toStrategyStep()

    const doc = new File(['Background\nSomething.'], 'client-brief.txt', { type: 'text/plain' })
    const input = screen.getByTestId('brief-ingest-file') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [doc] } })
    })
    expect(screen.getByTestId('brief-ingest-source-note')).toHaveTextContent('client-brief.txt')

    // Filed already — no submit needed, and nothing is being held in the browser.
    expect(fileDocumentsMutate).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'f-refs', clientId: 'c1', files: [doc] }),
      expect.anything(),
    )
  })

  // ---- a slow call must not undo work done while it was running ----
  //
  // A model call can take 45 seconds and the form stays editable throughout, which is the
  // right behaviour. What was wrong was that the result was merged into the form as it had
  // been when the button was pressed, and that whole stale snapshot was written back — so
  // every keystroke made during the call was destroyed, and the field the user had just
  // typed into was then reported as "filled from the document".

  /** Start an ingest that will not resolve until the returned `finish` is called. */
  function startSlowIngest(result: Record<string, unknown>) {
    let release!: () => void
    ingestMutate.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(result))),
    )
    fireEvent.click(screen.getByTestId('brief-ingest-toggle-mode'))
    fireEvent.change(screen.getByTestId('brief-ingest-paste'), {
      target: { value: 'Background\nAnything.' },
    })
    fireEvent.click(screen.getByTestId('brief-ingest-run'))
    return async () => {
      await act(async () => {
        release()
      })
    }
  }

  it('keeps what the user typed while the call was in flight, and does not claim it', async () => {
    toStrategyStep()
    const finish = startSlowIngest({
      source: 'model',
      oversized: [],
      fields: { background: 'From the document.', proposition: 'The document’s proposition.' },
    })

    // The user carries on working during the call.
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Typed while waiting.' },
    })
    chooseLanguage()

    await finish()

    expect(screen.getByTestId('wizard-brief-proposition')).toHaveValue('Typed while waiting.')
    // And it is not marked as machine-filled, because it is not.
    expect(screen.queryByTestId('wizard-brief-proposition-suggested')).not.toBeInTheDocument()
    // The genuinely empty field still fills, so the feature still works.
    expect(screen.getByTestId('wizard-brief-background')).toHaveValue('From the document.')
    expect(screen.getByTestId('brief-ingest-status').textContent).toContain('Filled 1 field')
  })

  it('does not reset work done on a later step while the call was in flight', async () => {
    toStrategyStep()
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Needed to leave step 2.' },
    })
    chooseLanguage()
    const finish = startSlowIngest({
      source: 'model',
      oversized: [],
      fields: { background: 'From the document.' },
    })

    // The user moves on and starts building deliverables while the call runs.
    fireEvent.click(screen.getByTestId('wizard-next'))
    typePiece('Hero film — 30s')

    await finish()

    expect(q('[data-testid^="wizard-work-piece-"]')).toHaveTextContent('Hero film — 30s')
  })

  // ---- only fields the wizard will actually show (ADR-0044 §5) ----

  it('counts every field it filled, because every field is now on screen', async () => {
    // This replaces a test that asserted performance fields were NOT filled on a 360 brief.
    // ADR-0050 d.5 removed the campaign-level brief type, so nothing hides them any more and
    // there is no invisible-but-counted field left to guard against. The rule the old test
    // protected still holds and is still worth asserting: **the count describes what is on
    // screen.** It is just that the screen now shows everything.
    ingestMutate.mockResolvedValue({
      source: 'model',
      oversized: [],
      fields: { insight: 'Effort, not spend.', perfBudget: 'USD 40,000', perfPlatforms: 'Meta' },
    })
    toStrategyStep()
    await pasteAndIngest()

    expect(screen.getByTestId('wizard-brief-card-journey')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-brief-perfBudget-suggested')).toBeInTheDocument()
    expect(screen.getByTestId('brief-ingest-status').textContent).toContain('Filled 3 fields')
  })

  it('does fill the performance fields when the brief type shows them', async () => {
    ingestMutate.mockResolvedValue({
      source: 'model',
      oversized: [],
      fields: { insight: 'Effort, not spend.', perfBudget: 'USD 40,000' },
    })
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Performance' } })
    fireEvent.click(screen.getByTestId('wizard-next'))

    await pasteAndIngest()

    expect(screen.getByTestId('wizard-brief-card-journey')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-brief-perfBudget')).toHaveValue('USD 40,000')
    expect(screen.getByTestId('wizard-brief-perfBudget-suggested')).toBeInTheDocument()
    expect(screen.getByTestId('brief-ingest-status').textContent).toContain('Filled 2 fields')
  })

  it('refuses Next while a field the brief filled is unchecked, naming each one (ADR-0044, 24 Sep)', async () => {
    ingestMutate.mockResolvedValue({
      source: 'model',
      oversized: [],
      fields: { background: 'Season 1 worked.', task: 'Make it obvious.', proposition: 'Every purchase is a ticket.' },
    })
    toStrategyStep()
    await pasteAndIngest()
    chooseLanguage()

    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    const refusal = screen.getByTestId('wizard-error')
    expect(refusal).toHaveTextContent('have not been checked')
    expect(refusal).toHaveTextContent('Background')
    expect(refusal).toHaveTextContent('The task')
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('wizard-error-dialog')).getAllByRole('button').at(-1)!)

    // Kept, edited, kept: nothing left to check, and the step lets go.
    fireEvent.click(screen.getByTestId('wizard-brief-background-keep'))
    fireEvent.change(screen.getByTestId('wizard-brief-task'), { target: { value: 'Make it obvious in three beats.' } })
    fireEvent.click(screen.getByTestId('wizard-brief-proposition-keep'))
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.queryByTestId('wizard-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  })

  it('will not leave step 2 without a language, and says what to do (ADR-0117 addendum, Q19)', async () => {
    toStrategyStep()
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'Every purchase is a ticket.' } })
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('Choose at least one language this campaign is made in')
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('wizard-error-dialog')).getAllByRole('button').at(-1)!)
    // Said where the choice is made, until it is made — there is no default.
    expect(screen.getByTestId('wizard-languages-missing')).toBeInTheDocument()
    chooseLanguage()
    expect(screen.queryByTestId('wizard-languages-missing')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  })

  it('never holds someone up over a budget they cannot see', async () => {
    canSeeBudget.value = false
    try {
      ingestMutate.mockResolvedValue({
        source: 'model',
        oversized: [],
        fields: { proposition: 'Every purchase is a ticket.', perfBudget: 'USD 40,000' },
      })
      toStrategyStep()
      await pasteAndIngest()
      fireEvent.click(screen.getByTestId('wizard-brief-proposition-keep'))
      chooseLanguage()
      await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
      expect(screen.queryByTestId('wizard-error')).not.toBeInTheDocument()
      expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    } finally {
      canSeeBudget.value = true
    }
  })

  it('hides the budget from someone without campaign_budget:view, and does not count it as filled (I56.18)', async () => {
    canSeeBudget.value = false
    try {
      ingestMutate.mockResolvedValue({
        source: 'model',
        oversized: [],
        fields: { insight: 'Effort, not spend.', perfBudget: 'USD 40,000' },
      })
      toStrategyStep()
      await pasteAndIngest()

      expect(screen.queryByTestId('wizard-brief-perfBudget')).not.toBeInTheDocument()
      expect(screen.queryByTestId('wizard-brief-perfBudget-suggested')).not.toBeInTheDocument()
      // The count describes what is on screen: the insight, not the hidden budget.
      expect(screen.getByTestId('brief-ingest-status').textContent).toContain('Filled 1 field')
    } finally {
      canSeeBudget.value = true
    }
  })

  // ---- the "left alone" message is about the USER's writing ----

  it('does not credit the user with a field the previous ingest filled', async () => {
    ingestMutate.mockResolvedValue({
      source: 'model',
      oversized: [],
      fields: { insight: 'From the document.' },
    })
    toStrategyStep()
    await pasteAndIngest()
    expect(screen.getByTestId('wizard-brief-insight-suggested')).toBeInTheDocument()

    // Run it again. `insight` is non-empty now — but it is the machine's, not the user's.
    await act(async () => {
      fireEvent.click(screen.getByTestId('brief-ingest-run'))
    })

    const status = screen.getByTestId('brief-ingest-status').textContent ?? ''
    expect(status).not.toContain('you had already written')
    expect(screen.getByTestId('wizard-brief-insight-suggested')).toBeInTheDocument()
  })

  // ---- an over-long section is named, not silently dropped or truncated ----

  it('says a section was too long to use rather than leaving an unexplained blank', async () => {
    ingestMutate.mockResolvedValue({
      source: 'model',
      oversized: ['background'],
      fields: { insight: 'Short enough.' },
    })
    toStrategyStep()
    await pasteAndIngest()

    expect(screen.getByTestId('wizard-brief-background')).toHaveValue('')
    expect(screen.queryByTestId('wizard-brief-background-suggested')).not.toBeInTheDocument()
    const status = screen.getByTestId('brief-ingest-status')
    expect(status).toHaveTextContent('too long')
    expect(status.className).toContain('form-error')
  })

  // ---- the promise to file the source document is kept, or the failure is shown ----

  it('says so when the source document could not be filed, without blocking the brief', async () => {
    // The retry-or-continue pair that used to live here is gone with the staging it existed for
    // (ADR-0067 d.6). Filing now happens on step 2, so a failure interrupts nothing: the campaign
    // is not yet submitted, the file is still on their disk, and the Library takes it any time.
    fileDocumentsMutate.mockReset().mockImplementation((_args, opts) =>
      opts?.onSuccess?.([{ name: 'client-brief.txt', ok: false }]),
    )
    ingestMutate.mockResolvedValue({ source: 'model', oversized: [], fields: { proposition: 'Say this.' } })
    toStrategyStep()

    const doc = new File(['Background\nSomething.'], 'client-brief.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.change(screen.getByTestId('brief-ingest-file'), { target: { files: [doc] } })
    })

    const shown = screen.getByTestId('wizard-error')
    expect(shown).toHaveTextContent('client-brief.txt')
    expect(shown).toHaveTextContent('References')
    // No dead end: the brief carries on from here.
    expect(screen.queryByTestId('wizard-retry-filing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-skip-filing')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
  })
})

// ADR-0048 d.4: the model PROPOSES the deliverable list, a person confirms it. The rows are
// marked until touched, nothing is proposed over work somebody has already done, and a
// failure leaves the table exactly as usable as it was before this feature existed.
// ADR-0101 / CB-v3-02b merged into step 3 (Edward, 24 Sep): the proposal lands on The work, in
// named workstreams. Proposed pieces keep or drop with a tick; a kept group needs a department; the
// owner is a lead, the group's own department first; *Keep these — go to timing* drops what is
// dropped and then asks what the work step always asked.
describe('BriefWizard — the work step with the proposal on it (CB-v3-02b → 03, ADR-0101)', () => {
  beforeEach(() => {
    proposePending = false
    proposeMutate.mockReset().mockResolvedValue(
      proposal(
        [
          { name: 'Reel', quantity: 3, typeCode: 'SOC-004', needsType: false, from: 'watch the draw', group: 0 },
          { name: 'Key visual', quantity: 1, typeCode: 'VID-008', needsType: false, from: 'make it obvious', group: 0 },
          { name: 'Caption set', quantity: 1, typeCode: 'SOC-004', needsType: false, from: null, group: 1 },
        ],
        { types: 'offered', channels: 'offered' },
        [
          { name: 'Draw night', departmentId: 'dep-av' },
          { name: 'Captions', departmentId: null },
        ],
      ),
    )
  })

  async function toTheWork() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'LUMA S2' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'Every purchase is a ticket.' } })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
  }
  const groupIds = () =>
    screen.getAllByTestId(/^wizard-work-group-w/).map((g) => g.getAttribute('data-testid')!.replace('wizard-work-group-', ''))
  const pieceIds = () =>
    screen.getAllByTestId(/^wizard-work-piece-/).map((r) => r.getAttribute('data-testid')!.replace('wizard-work-piece-', ''))

  it('lands the proposal on step 3 in its groups, with where each piece came from', async () => {
    await toTheWork()
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-next')).toHaveTextContent('Keep these — go to timing')
    const [draw, captions] = groupIds()
    expect(screen.getByTestId(`wizard-work-group-name-${draw}`)).toHaveValue('Draw night')
    expect(screen.getByTestId(`wizard-work-dept-${draw}`)).toHaveValue('dep-av')
    // d.3: the department the model could not place is left for the person.
    expect(screen.getByTestId(`wizard-work-dept-${captions}`)).toHaveValue('')
    expect(within(screen.getByTestId(`wizard-work-group-${draw}`)).getAllByTestId(/^wizard-work-piece-/)).toHaveLength(2)
    expect(screen.getByTestId(`wizard-work-piece-${pieceIds()[0]}`)).toHaveTextContent('from “watch the draw”')
    expect(screen.getByTestId(`wizard-work-piece-${pieceIds()[0]}`)).toHaveTextContent('×3')
    expect(screen.getByTestId(`wizard-work-proposed-${pieceIds()[0]}`)).toBeInTheDocument()
  })

  // I66.9 (Edward, 29 Sep): only the group's own department's leads — no other department's after them.
  it('offers only leads as owners, and only the group\'s own department\'s', async () => {
    await toTheWork()
    const [draw, captions] = groupIds()
    const options = (gid: string) =>
      Array.from((screen.getByTestId(`wizard-work-owner-${gid}`) as HTMLSelectElement).options).map((o) => o.value)
    expect(options(draw!)).toEqual(['', 'l1'])
    // A group with no department yet offers every lead; choosing one narrows it.
    expect(options(captions!)).toEqual(['', 'l1', 'l2'])
    fireEvent.change(screen.getByTestId(`wizard-work-dept-${captions}`), { target: { value: 'dep-content' } })
    expect(options(captions!)).toEqual(['', 'l2'])
    // Reassignment is allowed — the owner can be set, and cleared.
    fireEvent.change(screen.getByTestId(`wizard-work-owner-${draw}`), { target: { value: 'l1' } })
    expect(screen.getByTestId(`wizard-work-owner-${draw}`)).toHaveValue('l1')
    fireEvent.change(screen.getByTestId(`wizard-work-owner-${draw}`), { target: { value: '' } })
    expect(screen.getByTestId(`wizard-work-owner-${draw}`)).toHaveValue('')
  })

  it('will not go on while a kept group has no department, and names it', async () => {
    await toTheWork()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('Captions')
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  })

  it('drops what is dropped when moving on, and asks for owners on what is kept', async () => {
    await toTheWork()
    const [draw, captions] = groupIds()
    // Dropping every piece of a proposed group drops the group too — it needs no department then.
    fireEvent.click(screen.getByTestId(`wizard-work-drop-all-${captions}`))
    const firstReel = pieceIds()[0]!
    fireEvent.click(screen.getByTestId(`wizard-work-keep-${firstReel}`))
    expect(screen.getByTestId(`wizard-work-piece-${firstReel}`).className).toContain('is-dropped')
    expect(screen.getByTestId('wizard-work-summary')).toHaveTextContent('1 kept, 2 dropped')
    // A change of mind is one press away.
    fireEvent.click(screen.getByTestId(`wizard-work-keep-all-${draw}`))
    fireEvent.click(screen.getByTestId(`wizard-work-keep-${firstReel}`))
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })

    // The dropped pieces and the emptied group are gone; the kept one still needs its owner.
    expect(screen.getAllByTestId(/^wizard-work-piece-/)).toHaveLength(1)
    expect(screen.queryByTestId(`wizard-work-group-${captions}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-error')).toHaveTextContent(/owner/i)
    // Named, not "every piece" (Edward, 24 Sep: "Refuse and name them").
    const kept = screen.getAllByTestId(/^wizard-work-piece-/)[0]!.querySelector('.proposal-row-name')!.textContent!
    expect(screen.getByTestId('wizard-error')).toHaveTextContent(`These deliverables have no owner yet: ${kept}`)
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  })

  it('goes back to the brief, and a second Next does not propose again', async () => {
    await toTheWork()
    fireEvent.click(screen.getByTestId('wizard-back'))
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    expect(proposeMutate).toHaveBeenCalledTimes(1)
  })
})

// ADR-0101 d.9 (Edward, 24 Sep): workstreams are a switch on step 1, beside the phases, on by
// default. Off: the model is asked for pieces only, and the work is one plain list.
// I49.73: a refused Next marks each missing field where it sits — and the mark goes the moment the
// field is filled, not only on the next good Next (24 Sep walkthrough: a typed name still read
// "Required before continuing").
describe('BriefWizard — the missing marks clear as the fields are filled', () => {
  it('marks the name on a refused Next, and clears it once a name is typed', () => {
    renderWizard()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-name-missing')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-name')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'LUMA S2' } })
    expect(screen.queryByTestId('wizard-name-missing')).toBeNull()
    expect(screen.getByTestId('wizard-name')).not.toHaveAttribute('aria-invalid')
    // The client, still empty, keeps its mark.
    expect(screen.getByTestId('wizard-client')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('BriefWizard — no workstreams switch (ADR-0116 d.2)', () => {
  it('step 1 has no workstreams switch: every campaign uses workstreams', () => {
    renderWizard()
    expect(screen.queryByTestId('wizard-workstreams-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-phases-toggle')).not.toBeInTheDocument()
  })

  it('will not go on to timing while a piece is in no workstream, and names it (ADR-0116 d.3)', async () => {
    proposePending = false
    proposeMutate.mockReset().mockResolvedValue(
      proposal([{ name: 'Reel', quantity: 1, typeCode: 'SOC-004', needsType: false, from: 'watch the draw', group: null }], undefined, []),
    )
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'LUMA S2' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'Every purchase is a ticket.' } })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    // The piece shows under the heading that asks for it to be moved, and nothing can be added there.
    expect(screen.getByTestId('wizard-work-group-__ungrouped__')).toHaveTextContent('move each one into a workstream')
    expect(screen.queryByTestId('wizard-work-new-__ungrouped__')).not.toBeInTheDocument()
    setOwner(pieceId())
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('These deliverables are not in a workstream yet: Reel.')
    expect(screen.queryByTestId('wizard-step-4')).not.toBeInTheDocument()
  })
})

describe('BriefWizard — proposed deliverables (ADR-0048)', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    ingestMutate.mockReset().mockResolvedValue({ fields: {}, oversized: [], source: 'model' })
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    ingestPending = false
    proposePending = false
  })

  /** Fill steps 1 and 2 and land on the deliverables step. */
  /** Onto the work step, where the proposal lands, without waiting for it. */
  async function toProposalScreen() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Zeta keeps you in the room.' },
    })
    chooseLanguage()
    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-next'))
    })
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  }

  async function toDeliverablesStep() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Zeta keeps you in the room.' },
    })
    chooseLanguage()
    // Phases are on step 1 now (CB-v3-01). This Next proposes, on CB-v3-02b, and Keep goes on.
    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-next'))
    })
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  }

  it('previews the tasks a typed row will produce, says when a type has no list, and shows nothing for a row with no entry (22 Sep)', async () => {
    proposeMutate.mockResolvedValue(
      proposal([
        { name: 'Reel', quantity: 3, typeCode: 'SOC-004', channel: null },
        { name: 'TVC', quantity: 1, typeCode: 'VID-001', channel: null },
        { name: 'a hologram', quantity: 1, typeCode: null, channel: null },
      ]),
    )
    await toDeliverablesStep()
    const ids = screen.getAllByTestId(/^wizard-work-piece-/).map((el) => el.getAttribute('data-testid')!.replace('wizard-work-piece-', ''))
    // The Reel: one Script, three Create Reel — the materialiser's names, before it runs: the campaign and, on a
    // unit, the type and its number (ADR-0071 addendum, 4 Oct).
    // The preview sits under the TYPE in the piece dialog now, which is where the type is
    // chosen — seeing what it produces after the dialog has closed is too late to act on.
    openPiece(ids[0]!)
    const reel = screen.getByTestId('wizard-piece-tasks')
    expect(within(reel).getByTestId('wizard-piece-tasks-toggle')).toHaveTextContent('4 task(s)')
    const list = within(reel).getByTestId('wizard-piece-tasks-list')
    expect(list).toHaveTextContent('Script — Zeta Ramadan')
    expect(list).toHaveTextContent('Create Reel — Zeta Ramadan · Reel 1')
    expect(list).toHaveTextContent('Create Reel — Zeta Ramadan · Reel 3')
    // The TVC's type has no template: said, not hidden.
    fireEvent.click(screen.getByTestId('wizard-piece-cancel'))
    openPiece(ids[1]!)
    expect(screen.getByTestId('wizard-piece-tasks-none')).toHaveTextContent(/No task list/)
    // The hologram has no catalogue entry yet: nothing to preview.
    fireEvent.click(screen.getByTestId('wizard-piece-cancel'))
    // A row with no catalogue entry has no list to preview, and says nothing rather than
    // saying "none" — which would claim its type HAS no tasks.
    openPiece(ids[2]!)
    expect(screen.queryByTestId('wizard-piece-tasks')).toBeNull()
    expect(screen.queryByTestId('wizard-piece-tasks-none')).toBeNull()
  })

  it('proposes rows from the brief, marks each one, and states the count', async () => {
    proposeMutate.mockResolvedValue(
      proposal([
        { name: '60-second hero film', quantity: 1, typeCode: null, channel: null },
        { name: '15-second cutdown', quantity: 3, typeCode: null, channel: null },
      ]),
    )
    await toDeliverablesStep()

    // The count is on the proposal screen now; the work step has no amber recap (Edward, 24 Sep).
    expect(screen.queryByTestId('wizard-proposed-note')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId(/^wizard-work-piece-/)
    expect(rows).toHaveLength(2)
    expect(rows[0]!).toHaveTextContent('60-second hero film')
    // Every row carries the marker until somebody touches it.
    expect(screen.getAllByTestId(/^wizard-work-proposed-/)).toHaveLength(2)
  })

  it('sends the brief however it was filled — it cannot tell, and does not ask (d.3)', async () => {
    await toDeliverablesStep()
    expect(proposeMutate).toHaveBeenCalledTimes(1)
    const sent = proposeMutate.mock.calls[0]![0] as { brief: string }
    // The proposition was TYPED, not ingested, and it still reaches the planner.
    expect(sent.brief).toContain('Zeta keeps you in the room.')
    // ADR-0050 d.6: it sends the brief and NOTHING about who does the work. No disciplines,
    // no owners, no departments — those are the Account Manager's to decide. The one other thing
    // it carries is the campaign's workstreams switch (ADR-0101 d.9), which is about shape.
    expect(Object.keys(sent)).toEqual(['brief', 'grouped'])
    expect((sent as { grouped?: boolean }).grouped).toBe(true)
  })

  it('drops the marker from a row the moment it is edited', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: '60-second hero film', quantity: 1, typeCode: null, channel: null }]),
    )
    await toDeliverablesStep()
    const id = pieceId()
    expect(screen.getAllByTestId(/^wizard-work-proposed-/)).toHaveLength(1)

    // Editing a proposed row is the person taking it on, so the mark comes off on save.
    openPiece(id)
    setPieceField('name', '90-second hero film')
    setPieceField('owner', 'u1')
    savePiece()

    expect(screen.queryByTestId(/^wizard-work-proposed-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-proposed-note')).not.toBeInTheDocument()
  })

  it('leaves the table alone when the call fails — no worse than before the feature', async () => {
    proposeMutate.mockResolvedValue(proposal([]))
    await toDeliverablesStep()

    expect(screen.queryByTestId('wizard-proposed-note')).not.toBeInTheDocument()
    // No blank row to correct — the work screen starts with a line you type into and the
    // button that makes a workstream. Nothing proposed is not the same as nothing to do.
    expect(screen.queryAllByTestId(/^wizard-work-piece-/)).toHaveLength(0)
    expect(addLine()).toBeInTheDocument()
    expect(screen.getByTestId('wizard-work-new-group')).toBeInTheDocument()
  })

  it('shows the shared busy note while the list is being proposed', async () => {
    proposePending = true
    await toProposalScreen()
    expect(screen.getByTestId('busy-note')).toBeInTheDocument()
  })

  // Edward, 29 Aug: processing is shown in a modal. The model call takes seconds, and a second
  // Next during it is the double-submit Button was introduced for in I12.9 — the difference is
  // that this blocks the whole step rather than one button.
  it('blocks the step behind a busy dialog while the model is called', async () => {
    proposePending = true
    await toProposalScreen()
    const busy = screen.getByTestId('wizard-busy-propose')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('role', 'alertdialog')
  })

  // ------------------------------------------------------------------ ADR-0054
  // The model now proposes a TYPE from the tenant's own list. The row arrives classified, and the
  // Account Manager confirms a type instead of finding one in a 240-row list twenty-five times.

  it('lands the proposed CODE on the row as the tenant\'s own type', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'Ramadan Reel', quantity: 3, typeCode: 'VID-008', channel: 'INSTAGRAM' }]),
    )
    await toDeliverablesStep()

    // The ambiguity ADR-0054 exists for: 'Reel' is both SOC-004 and VID-008 in this fixture, and
    // the CODE is what decides. A model returning the NAME could not have selected either.
    const rows = screen.getAllByTestId(/^wizard-work-piece-/)
    const id = rows[0]!.getAttribute('data-testid')!.replace('wizard-work-piece-', '')
    // The type and the channel moved into the piece dialog (CB-v3-P8), so this is where they
    // are read now. The ID is what tells the two Reels apart — the NAME cannot, which is the
    // whole reason ADR-0054 has the model return a code.
    openPiece(id)
    expect((pieceField('type') as HTMLSelectElement).value).toBe('t-vid-008')
    expect((pieceField('channel') as HTMLSelectElement).value).toBe('INSTAGRAM')
  })

  it('leaves a row untyped when the code is one this workspace does not have', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'Mystery', quantity: 1, typeCode: 'ZZZ-999', channel: null }]),
    )
    await toDeliverablesStep()

    // ADR-0051 d.7 / ADR-0054 d.4: the row SURVIVES. It is still a deliverable somebody has to
    // make, and nothing filters it out or blocks submission on it.
    const rows = screen.getAllByTestId(/^wizard-work-piece-/)
    expect(rows).toHaveLength(1)
    const id = rows[0]!.getAttribute('data-testid')!.replace('wizard-work-piece-', '')
    // And it says so ON the row, not only in the refusal on Next.
    expect(screen.getByTestId(`wizard-work-warn-${id}`)).toBeInTheDocument()
    openPiece(id)
    expect((pieceField('type') as HTMLSelectElement).value).toBe('')
  })

  // ADR-0054 d.5. An empty Type column must never look like a model that had no opinion.
  it('says WHY the rows arrived without types when the vocabulary could not be offered', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'A thing', quantity: 1, typeCode: null, channel: null }], {
        types: 'empty',
        channels: 'offered',
      }),
    )
    await toDeliverablesStep()
    expect(screen.getByTestId('wizard-work-status')).toHaveTextContent(
      /no active deliverable types/i,
    )
  })

  it('says nothing when the vocabulary was offered normally', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'Ramadan Reel', quantity: 1, typeCode: 'SOC-004', channel: null }]),
    )
    await toDeliverablesStep()
    expect(screen.queryByTestId('wizard-work-status')).not.toBeInTheDocument()
  })

  it('says WHY there were no rows when the catalogue could not be read (ADR-0097 d.5)', async () => {
    proposeMutate.mockResolvedValue(proposal([], { types: 'unavailable', channels: 'unavailable' }))
    await toDeliverablesStep()
    // No catalogue means no proposals — and the reason is said rather than shown as a blank table.
    // The work step's status line says which: the catalogue, not an empty answer.
    expect(screen.getByTestId('wizard-work-status')).not.toHaveTextContent(/no deliverables were proposed/i)
  })

  // Edward, 29 Aug: a brief that clearly lists deliverables came back with none and the table was
  // simply blank. An empty proposal is a legal answer, but a blank table is indistinguishable from
  // a failure that was swallowed — the 27 August complaint in a new place. It is now stated.
  it('says so when the model answered and proposed nothing', async () => {
    proposeMutate.mockResolvedValue(proposal([]))
    await toDeliverablesStep()
    expect(screen.getByTestId('wizard-work-status')).toHaveTextContent(/no deliverables were proposed/i)
  })

  it('says nothing of the kind once rows do arrive', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'Hero film', quantity: 1, typeCode: null, channel: null }]),
    )
    await toDeliverablesStep()
    expect(screen.queryByTestId('wizard-work-status')).not.toBeInTheDocument()
  })
})

// Edward, 27 Aug, after an afternoon lost to a stale Edge Function returning 400 while the
// wizard showed an empty table and said nothing: "ANYWHERE AN ERROR COULD OCCUR IT SHOULD NOT
// FAIL SILENTLY". These are that rule, asserted.
describe('BriefWizard — no failure is silent', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    ingestMutate.mockReset().mockResolvedValue({ fields: {}, oversized: [], source: 'model' })
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    ingestPending = false
    proposePending = false
  })

  async function toDeliverablesStep() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Zeta keeps you in the room.' },
    })
    chooseLanguage()
    // Phases are on step 1 now (CB-v3-01). This Next proposes, on CB-v3-02b, and Keep goes on.
    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-next'))
    })
  }

  it.each([
    ['mismatch', /version behind/i],
    ['unavailable', /could not be reached/i],
    ['malformed', /shape this version understands/i],
    ['forbidden', /permission/i],
  ])('says what went wrong when the proposal fails as %s', async (code, expected) => {
    proposeMutate.mockRejectedValue(new DeliverablesRefusedError(code as never))
    await toDeliverablesStep()

    // The step still opens and the table is still usable — a failure never blocks the wizard.
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
    expect(addLine()).toBeInTheDocument()
    // But it SAYS so. An empty table with no message is what this suite exists to prevent.
    expect(screen.getByTestId('wizard-error')).toHaveTextContent(expected)
  })

  it('an empty proposal is silent, because nothing went wrong', async () => {
    // The one case that legitimately says nothing: the model read the brief and found no
    // deliverables in it. That is an answer, not a failure.
    proposeMutate.mockResolvedValue(proposal([]))
    await toDeliverablesStep()
    expect(screen.queryByTestId('wizard-error')).not.toBeInTheDocument()
  })
})

// Edward, 29 Aug: "delivery 2 days before go live, commence by 4 days before delivery" — and the
// go-live is optional, because the client often will not confirm one. The arithmetic itself is
// covered in src/lib/campaigns/go-live-dates.test.ts; this is what the WIZARD does with it.
describe('BriefWizard — dates worked back from go-live', () => {
  // I66.8: a date shows its year only when it is not this year, so pin "today" (the date only).
  afterEach(() => { vi.useRealTimers() })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    submitMutate.mockReset()
    ingestMutate.mockReset().mockResolvedValue({ fields: {}, oversized: [], source: 'model' })
    // ADR-0097 d.4: a row the model could not place blocks Next until chosen, so the fixture row
    // carries a catalogue code.
    proposeMutate.mockReset().mockResolvedValue(
      proposal([{ name: 'Hero film', quantity: 1, typeCode: 'VID-001', channel: null }]),
    )
    ingestPending = false
    proposePending = false
  })

  async function toTimingStep() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Zeta keeps you in the room.' },
    })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    // The owner lives in the piece dialog now, so naming one is a trip through it.
    setOwner(pieceId())
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()
  }

  // ADR-0078 / I41.9: WORKING days. 2027-03-15 is a Monday; Iraq works Sun–Thu, so two working
  // days back is Thursday the 11th (not Saturday the 13th).
  //
  // COMMENCE MOVED 7 Mar → 8 Mar (Edward, 24 Sep, `I56.11`): the count-back is INCLUSIVE, so the
  // four working days of work are 8, 9, 10 and 11 March and the due day is the fourth of them.
  // The old exclusive reading gave the work a clear spare day before it was due, and disagreed
  // with the timing screen, which had always counted the due day.
  it('fills the empty dates when a go-live is set, counting working days', async () => {
    await toTimingStep()
    fireEvent.change(screen.getByTestId('wizard-golive'), { target: { value: '2027-03-15' } })
    expect(dueText()).toBe('Thu, 11 Mar 2027')
    expect(startText()).toBe('Mon, 8 Mar 2027')
  })

  it('states the offsets it will apply before anything is typed', async () => {
    await toTimingStep()
    // Standing advice is an (i) tip now, not a paragraph on the screen (Edward, 24 Sep).
    fireEvent.click(screen.getByTestId('wizard-timing-golive-tip-button'))
    expect(screen.getByTestId('wizard-timing-golive-tip-body')).toHaveTextContent(/delivery 2 working days before it/i)
    expect(screen.getByTestId('wizard-timing-golive-tip-body')).toHaveTextContent(/4 working days before that/i)
  })

  // I41.8 (ADR-0075 d.9): a date inside the window WARNS and is allowed; after go-live is refused.
  it('warns on a due date inside the delivery window, and on one after go-live — and lets both proceed (ADR-0093)', async () => {
    await toTimingStep()
    fireEvent.change(screen.getByTestId('wizard-golive'), { target: { value: '2027-03-15' } })
    // Sunday the 14th: one working day left, two required — tight, allowed.
    setDue('2027-03-14')
    const warning = q('[data-testid^="wizard-timing-due-warning-"]')
    expect(warning).toHaveAttribute('data-severity', 'tight')
    expect(warning).toHaveTextContent(/1 working day\(s\) left/)
    // After go-live: a warning naming the client's agreement — not a refusal (ADR-0093).
    setDue('2027-03-16')
    const late = q('[data-testid^="wizard-timing-due-warning-"]')
    expect(late).toHaveAttribute('data-severity', 'after_go_live')
    expect(late).toHaveTextContent(/client's agreement/i)
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.queryByTestId('wizard-error')).toBeNull()
    expect(screen.getByTestId('wizard-step-5')).toBeInTheDocument()
  })

  it('says what it filled rather than changing the table silently', async () => {
    await toTimingStep()
    fireEvent.change(screen.getByTestId('wizard-golive'), { target: { value: '2027-03-15' } })
    expect(screen.getByTestId('wizard-golive-note')).toHaveTextContent(/^1 date filled from the go-live date.$/i)
  })

  // The property that matters: a date somebody typed is a commitment, and moving it because the
  // go-live shifted is the silent reschedule I17 was raised for.
  it('leaves a date already typed alone, and says how many it kept', async () => {
    await toTimingStep()
    // BOTH dates, so the row is untouched rather than half-filled — `kept` counts rows nothing
    // was written to, and a row missing one date still legitimately gets that one.
    // Saving a date stores its start too, so the row is whole rather than half-filled.
    setDue('2027-01-05')
    fireEvent.change(screen.getByTestId('wizard-golive'), { target: { value: '2027-03-15' } })
    expect(dueText()).toBe('Tue, 5 Jan 2027')
    expect(screen.getByTestId('wizard-golive-note')).toHaveTextContent(/1 already had a date and was left alone./)
  })

  it('refuses Next with a piece undated, and names it', async () => {
    await toTimingStep()
    const name = q('[data-testid^="wizard-timing-row-"] .timing-piece-name').textContent!
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toHaveTextContent(`These deliverables have no due date yet: ${name}`)
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()
  })

  it('derives nothing without a go-live, which is a normal way to plan', async () => {
    await toTimingStep()
    expect(dueText()).toBe('No date yet')
    expect(screen.queryByTestId('wizard-golive-note')).not.toBeInTheDocument()
  })
})

// Edward, 29 Aug: "the account manager is supposed to be assignable upon creation, the default is
// the Client Manager." Approval resolves coalesce(campaign, client) and refuses when both are null
// — a campaign under a client with no account manager could be approved by NOBODY, and sat at
// pending_approval with nothing under it assignable. That happened on the first real campaign.
describe('BriefWizard — the campaign names its account manager', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    ingestMutate.mockReset().mockResolvedValue({ fields: {}, oversized: [], source: 'model' })
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    ingestPending = false
    proposePending = false
  })

  it("pre-fills from the client's account manager when a client is chosen", () => {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    // u2 is Lina in the useAssignableUsers fixture.
    expect(screen.getByTestId('wizard-account-manager')).toHaveValue('Lina')
  })

  // I73.4: it offered the department and team leads (the deliverable owners) instead.
  it('offers the account managers, not the leads', () => {
    renderWizard()
    fireEvent.focus(screen.getByTestId('wizard-account-manager'))
    expect(screen.getByTestId('wizard-account-manager-option-am-sara')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard-account-manager-option-u1')).not.toBeInTheDocument()
  })

  it('can be changed to somebody else — pre-filled, not locked', () => {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    const box = screen.getByTestId('wizard-account-manager')
    fireEvent.change(box, { target: { value: 'Sara' } })
    fireEvent.blur(box, { target: { value: 'Sara' } })
    expect(box).toHaveValue('Sara')
  })

  it('sends it with the campaign', async () => {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Zeta keeps you in the room.' },
    })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    typePiece('Hero film')
    // The owner lives in the piece dialog now, so naming one is a trip through it.
    setOwner(pieceId())
    fireEvent.click(screen.getByTestId('wizard-next'))
    setDue('2027-03-13')
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.click(screen.getByTestId('wizard-review-approve'))

    // ADR-0067: the account manager is IDENTITY, so it is written when the draft is created on
    // leaving step 1 — not at submit. Approval still resolves coalesce(campaign, client), which
    // is the reason it is collected at all (29 Aug).
    expect(startDraftMutate).toHaveBeenCalledWith(
      expect.objectContaining({ accountManagerId: 'u2' }),
      expect.anything(),
    )
  })
})

describe('BriefWizard — brand documents and registering a brand (I35.2, I35.3)', () => {
  beforeEach(() => {
    createBrandMutate.mockReset()
    canFile.value = true
  })

  const pickClient = () =>
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })

  it('offers no filing until a brand is chosen — brand documents are filed under the BRAND', () => {
    renderWizard()
    pickClient()
    // A client-level fallback would file guidelines somewhere nobody looks for them, so there
    // deliberately is not one.
    expect(screen.queryByTestId('brand-filing')).not.toBeInTheDocument()
  })

  it('files into the brand\'s own folders once one is chosen', () => {
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: 'b1' } })

    expect(screen.getByTestId('brand-filing')).toBeInTheDocument()
    // Fenced to the brand, and showing what the provisioning trigger made.
    expect(screen.getByTestId('brand-filing-picker-crumb-f-brand')).toBeInTheDocument()
    expect(screen.getByTestId('brand-filing-picker-open-f-logos')).toHaveTextContent('Logos')
  })

  it('accepts several documents at once', () => {
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: 'b1' } })
    expect(screen.getByTestId('brand-filing-input')).toHaveAttribute('multiple')
  })

  it('says up front when the user cannot file, rather than failing on the first upload', () => {
    // Filing needs assets:manage, which the wizard itself does not require (ADR-0044 §8).
    canFile.value = false
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: 'b1' } })

    expect(screen.getByTestId('brand-filing-readonly')).toBeInTheDocument()
    expect(screen.queryByTestId('brand-filing-choose')).not.toBeInTheDocument()
    // Still browsable: seeing where things are filed is not the same as adding to it.
    expect(screen.getByTestId('brand-filing-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('brand-filing-picker-add')).not.toBeInTheDocument()
  })

  it('opens the register-a-brand dialog from the dropdown, and cancelling changes nothing', () => {
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: '__add_brand__' } })

    expect(screen.getByTestId('add-brand-dialog')).toBeInTheDocument()
    // Names the client: a brand registered under the wrong one is a folder tree in the wrong place.
    expect(screen.getByTestId('add-brand-dialog')).toHaveTextContent('Zeta')

    fireEvent.click(screen.getByTestId('add-brand-cancel'))
    expect(screen.queryByTestId('add-brand-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-brand')).toHaveValue('')
  })

  it('registers the brand against the chosen client and selects what was just made', () => {
    createBrandMutate.mockImplementation((_args, opts) => opts?.onSuccess?.('b1'))
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: '__add_brand__' } })
    fireEvent.change(screen.getByTestId('add-brand-name'), { target: { value: '  Harmony  ' } })
    fireEvent.submit(screen.getByTestId('add-brand-name').closest('form')!)

    expect(createBrandMutate).toHaveBeenCalledWith(
      { clientId: 'c1', name: 'Harmony' },
      expect.anything(),
    )
    expect(screen.queryByTestId('add-brand-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-brand')).toHaveValue('b1')
  })

  it('reports a duplicate brand name as a sentence, not a constraint', () => {
    createBrandMutate.mockImplementation((_args, opts) =>
      opts?.onError?.(Object.assign(new Error('dupe'), { code: '23505' })),
    )
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: '__add_brand__' } })
    fireEvent.change(screen.getByTestId('add-brand-name'), { target: { value: 'Zeta KW' } })
    fireEvent.submit(screen.getByTestId('add-brand-name').closest('form')!)

    expect(screen.getByTestId('add-brand-error')).toHaveTextContent('already has a brand with this name')
  })

  it('the brand row never leaves the sentinel in the form', () => {
    // `__add_brand__` reaching `brandId` would be submitted as a brand uuid and fail at the FK.
    renderWizard()
    pickClient()
    fireEvent.change(screen.getByTestId('wizard-brand'), { target: { value: '__add_brand__' } })
    fireEvent.click(screen.getByTestId('add-brand-cancel'))
    expect(screen.getByTestId('wizard-brand')).not.toHaveValue('__add_brand__')
  })
})

// ADR-0067: a campaign exists from step 2, as a draft, so step 2 has folders to file into.
describe('BriefWizard — the campaign is created as a draft on leaving step 1 (I35.4)', () => {
  beforeEach(() => {
    startDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.('draft-1'))
    updateDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.())
    submitMutate.mockReset()
    fileDocumentsMutate.mockReset()
    draftQuery.data = null
    canFile.value = true
  })

  function fillStep1(name = 'Zeta Ramadan') {
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: name } })
  }

  // I49.73: a refused Next names what is missing and marks the field.
  it('names the missing proposition on step 2 and marks the field', () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error').textContent).toMatch(/proposition/i)
    expect(screen.getByTestId('wizard-brief-proposition')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('wizard-brief-proposition-missing')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'One line.' } })
    chooseLanguage()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.queryByTestId('wizard-brief-proposition-missing')).not.toBeInTheDocument()
  })

  it('creates the draft on the way out of step 1, not at submit', () => {
    renderWizard()
    fillStep1()
    expect(startDraftMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(startDraftMutate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
  })

  it('stays on step 1 when the draft cannot be created — there is nothing to go forward to', () => {
    startDraftMutate.mockImplementation((_a, opts) => opts?.onError?.(new Error('nope')))
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('could not be started')
  })

  it('reports a duplicate name at step 2 instead of after five steps (d.5)', () => {
    startDraftMutate.mockImplementation((_a, opts) =>
      opts?.onError?.(Object.assign(new Error('dupe'), { code: '23505' })),
    )
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toHaveTextContent('already')
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument()
  })

  it('going back and forward UPDATES the draft rather than creating a second one', () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.click(screen.getByTestId('wizard-back'))
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Eid' } })
    fireEvent.click(screen.getByTestId('wizard-next'))

    expect(startDraftMutate).toHaveBeenCalledTimes(1)
    expect(updateDraftMutate).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'draft-1', name: 'Zeta Eid' }),
      expect.anything(),
    )
  })

  it('files campaign reference materials into the campaign\'s own folders on step 2', () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))

    // A line under the drop zone (Edward, 24 Sep); the folders open only when asked for.
    expect(screen.queryByTestId('campaign-filing')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-references-toggle'))
    expect(screen.getByTestId('campaign-filing')).toBeInTheDocument()
    // Fenced to this campaign: the breadcrumb starts at it and cannot reach the client root.
    expect(screen.getByTestId('campaign-filing-picker-crumb-f-camp')).toBeInTheDocument()
    expect(screen.getByTestId('campaign-filing-picker-open-f-refs')).toHaveTextContent('References')
    expect(screen.getByTestId('campaign-filing-input')).toHaveAttribute('multiple')
  })

  it('offers no campaign filing before the draft exists', () => {
    renderWizard()
    fillStep1()
    expect(screen.queryByTestId('campaign-filing')).not.toBeInTheDocument()
  })


  it('files the screenshot ONCE, however many times step 1 is revisited', async () => {
    // recordReceipt runs on every Next from step 1, because somebody may have gone back to
    // correct the date. Re-uploading each time would leave three copies of one screenshot in
    // References with the receipt pointing at the last — and `assets` has no unique constraint
    // to catch it, so the duplication would be silent. The receipt ROW upserts, so only the
    // upload needs guarding.
    fileDocumentsAsync.mockClear()
    saveReceiptAsync.mockClear()
    readReceiptMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ subject: 'Ramadan', receivedDate: '2026-09-01', receivedTime: '14:32', partial: false }),
    )
    renderWizard()
    fillStep1()

    const input = screen.getByTestId('receipt-file') as HTMLInputElement
    const file = new File(['bytes'], 'shot.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })

    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-back')) })
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })

    expect(fileDocumentsAsync).toHaveBeenCalledTimes(1)
    // The fields are still re-saved, because they are the thing that may have changed.
    expect(saveReceiptAsync.mock.calls.length).toBeGreaterThan(1)
  })

  it('resumes a draft from the route, restoring what step 1 collected', () => {
    draftQuery.data = {
      id: 'draft-1',
      clientId: 'c1',
      brandId: 'b1',
      name: 'Half-written brief',
      accountManagerId: 'u2',
    }
    render(
      <MemoryRouter initialEntries={['/campaigns/new?draft=draft-1']}>
        <BriefWizard />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('wizard-client')).toHaveValue('c1')
    expect(screen.getByTestId('wizard-name')).toHaveValue('Half-written brief')
    expect(screen.getByTestId('wizard-brand')).toHaveValue('b1')

    // And it is the SAME draft: moving on updates rather than creating a second campaign.
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(startDraftMutate).not.toHaveBeenCalled()
    expect(updateDraftMutate).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'draft-1' }),
      expect.anything(),
    )
  })

  // ADR-0086 d.10: a promoted single job opens the builder at Strategy, step 1 read as done.
  it('opens at the step the route asks for, with step 1 marked done', () => {
    draftQuery.data = {
      id: 'draft-1',
      clientId: 'c1',
      brandId: 'b1',
      name: 'Promoted job',
      accountManagerId: 'u2',
    }
    render(
      <MemoryRouter initialEntries={['/campaigns/new?draft=draft-1&step=2']}>
        <BriefWizard />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-dot-1')).toHaveClass('done')
  })

  // A link to something that is no longer a draft must not open a blank step 1 under a second name.
  it('says so, with a way out, when the route names something that is not a draft', () => {
    draftQuery.data = null
    render(
      <MemoryRouter initialEntries={['/campaigns/new?draft=cmp-live']}>
        <BriefWizard />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('wizard-not-draft')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-not-draft-open')).toHaveAttribute('href', '/campaigns/cmp-live')
    expect(screen.queryByTestId('wizard-step-1')).toBeNull()
  })
})

// I40. ADR-0067 promises a draft is "resumable". Only its identity ever was: brand, name and
// account manager were saved on leaving step 1, and everything typed afterwards lived in React
// state until submit. Edward, 5 Sep, on returning to step 2: "all the data is missing… the form is
// blank." These are the tests that make the promise true in both directions.
describe('BriefWizard — a draft keeps what was typed into it (I40)', () => {
  beforeEach(() => {
    startDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.('draft-1'))
    updateDraftMutate.mockReset().mockImplementation((_a, opts) => opts?.onSuccess?.())
    submitMutate.mockReset()
    draftQuery.data = null
  })

  function fillStep1() {
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'Zeta Ramadan' } })
  }

  it('saves the strategy when step 2 is left, rather than holding it until submit', async () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))

    fireEvent.change(screen.getByTestId('wizard-brief-background'), {
      target: { value: 'Ramadan is the whole year in one month.' },
    })
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Closer, for less.' },
    })
    chooseLanguage()
    fireEvent.click(screen.getByTestId('wizard-next'))

    expect(updateDraftMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'draft-1',
        brief: expect.objectContaining({
          background: 'Ramadan is the whole year in one month.',
          proposition: 'Closer, for less.',
        }),
      }),
      expect.anything(),
    )
    // Step 2 leads to what the brief suggests (CB-v3-02b), then to the work.
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()
  })

  it('leaves the brief ALONE when step 1 is left, so going back cannot erase later steps', () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Closer, for less.' },
    })
    chooseLanguage()
    fireEvent.click(screen.getByTestId('wizard-back'))
    fireEvent.click(screen.getByTestId('wizard-next'))

    // The step 1 save carries identity only. `brief` absent means "leave it" in the RPC; a null
    // or an empty object here would blank the column and lose the step 2 the person just typed.
    const step1Save = updateDraftMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(step1Save.name).toBe('Zeta Ramadan')
    expect(step1Save).not.toHaveProperty('brief')
  })

  it('does not advance when the save fails — it never claims to have kept what it dropped', () => {
    renderWizard()
    fillStep1()
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), {
      target: { value: 'Closer, for less.' },
    })
    chooseLanguage()
    updateDraftMutate.mockImplementation((_a, opts) => opts?.onError?.(new Error('offline')))
    fireEvent.click(screen.getByTestId('wizard-next'))

    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-error')).toBeInTheDocument()
  })

  it('reopens a resumed draft with steps 2 to 4 filled, not blank', () => {
    draftQuery.data = {
      id: 'draft-1',
      clientId: 'c1',
      brandId: 'b1',
      name: 'Half-written brief',
      accountManagerId: 'u2',
      goLiveAt: '2026-10-01T00:00:00.000Z',
      brief: {
        background: 'Ramadan is the whole year in one month.',
        proposition: 'Closer, for less.',
        insight: 'Nobody wants to be the one who called last.',
        performance: null,
        // ADR-0117 addendum (Q19): a draft that leaves step 2 has its language, and resumes with it.
        languages: ['ar'],
        // ADR-0116 d.3: a campaign piece is in a workstream, so the saved draft keeps it in one.
        workstreams: [{ id: 'w-saved', name: 'Main work', departmentId: 'dep-av', ownerUserId: null }],
        deliverables: [
          {
            name: 'Hero film',
            ownerUserId: 'u2',
            quantity: 3,
            commenceAt: '2026-09-10',
            dueAt: '2026-09-24',
            deliverableTypeId: null,
            channel: null,
            format: null,
            workstreamId: 'w-saved',
          },
        ],
      },
    }
    render(
      <MemoryRouter initialEntries={['/campaigns/new?draft=draft-1']}>
        <BriefWizard />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-brief-background')).toHaveValue(
      'Ramadan is the whole year in one month.',
    )
    expect(screen.getByTestId('wizard-brief-proposition')).toHaveValue('Closer, for less.')
    // A draft saved before phases existed resumes with them off, and they are on step 1 now,
    // so the walk from the brief goes straight to the work.
    expect(screen.getByTestId('wizard-brief-insight')).toHaveValue(
      'Nobody wants to be the one who called last.',
    )

    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-work-piece-resumed-0')).toHaveTextContent('Hero film')
    openPiece('resumed-0')
    expect(screen.getByTestId('wizard-piece-quantity')).toHaveValue(3)
    fireEvent.click(screen.getByTestId('wizard-piece-cancel'))

    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-golive')).toHaveValue('2026-10-01')
  })

  it('opens a pre-I40 draft — one with no brief stored — without breaking', () => {
    draftQuery.data = {
      id: 'draft-1',
      clientId: 'c1',
      brandId: 'b1',
      name: 'Older draft',
      accountManagerId: 'u2',
      goLiveAt: null,
      brief: null,
    }
    render(
      <MemoryRouter initialEntries={['/campaigns/new?draft=draft-1']}>
        <BriefWizard />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('wizard-name')).toHaveValue('Older draft')
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-brief-proposition')).toHaveValue('')
  })
})

// ADR-0096 d.8 / ADR-0097 d.4, d.6 (Edward, 20 Sep): the Phases step, the model's suggested phase,
// the flagged row that blocks Next, the due-date fallback, and what the submit carries.
describe('BriefWizard — phases (ADR-0096) and proposals from the catalogue (ADR-0097)', () => {
  beforeEach(() => {
    submitMutate.mockReset()
    approveMutate.mockReset()
    proposeMutate.mockReset().mockResolvedValue(proposal([]))
    proposePending = false
  })

  /** Phases now sit on step 1 beside the campaign's name (CB-v3-01), so this never advances. */
  function toPhasesStep() {
    renderWizard()
    fireEvent.change(screen.getByTestId('wizard-client'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wizard-name'), { target: { value: 'LUMA S2' } })
    expect(screen.getByTestId('wizard-phases')).toBeInTheDocument()
  }

  /** Leave step 1 for the brief, then the brief for the work — which proposes on the way in. */
  async function onToTheWork() {
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'Every purchase is a ticket.' } })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
  }

  /** One phase, through the CB-v3-P1 dialog — the only way to make one now. A null start keeps
   *  the one the dialog filled from the phase before. */
  function addPhase(name: string, startsOn: string | null, endsOn: string) {
    fireEvent.click(screen.getByTestId('wizard-phases-add'))
    fireEvent.change(screen.getByTestId('wizard-phase-dialog-name'), { target: { value: name } })
    if (startsOn) fireEvent.change(screen.getByTestId('wizard-phase-dialog-starts'), { target: { value: startsOn } })
    fireEvent.change(screen.getByTestId('wizard-phase-dialog-date'), { target: { value: endsOn } })
    fireEvent.click(screen.getByTestId('wizard-phase-dialog-submit'))
  }

  function definePhases() {
    // The first phase is given its start; the second's is filled as the day after the first ends.
    addPhase('Pre-Launch', '2026-10-01', '2026-10-08')
    addPhase('Week 1', null, '2026-10-15')
  }

  const rowId = pieceId

  it('with no phases the card offers + Add a phase and Next does not ask for any (ADR-0116 d.1)', () => {
    toPhasesStep()
    expect(screen.queryAllByTestId(/^wizard-phases-row-/)).toHaveLength(0)
    expect(screen.getByTestId('wizard-phases-add')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.queryByText(/requires phases/)).not.toBeInTheDocument()
  })

  it('a phase defined through the dialog appears on the panel with its dates', () => {
    toPhasesStep()
    addPhase('Pre-Launch', '2026-09-12', '2026-09-17')
    const rows = screen.getAllByTestId(/^wizard-phases-row-/)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent(/12.*17 Sep/)
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument()
  })

  it('a phase ending before the one before it ends is refused in the dialog', () => {
    toPhasesStep()
    addPhase('Week 4', '2026-09-28', '2026-10-05')
    // The second phase starts the day after the first ends, so an earlier end is backwards.
    fireEvent.click(screen.getByTestId('wizard-phases-add'))
    fireEvent.change(screen.getByTestId('wizard-phase-dialog-name'), { target: { value: 'Backwards' } })
    fireEvent.change(screen.getByTestId('wizard-phase-dialog-date'), { target: { value: '2026-10-01' } })
    expect(screen.getByTestId('wizard-phase-dialog-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('wizard-phase-dialog-cancel'))
    expect(screen.getAllByTestId(/^wizard-phases-row-/)).toHaveLength(1)
  })

  it('hands the phases to the proposal and lands the suggested phase on the row', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'Reel', quantity: 2, typeCode: 'SOC-004', needsType: false, note: null, channel: null, phaseNumber: 2 }]),
    )
    toPhasesStep()
    definePhases()
    await onToTheWork()

    const sent = proposeMutate.mock.calls[0]![0] as { brief: string; phases: { number: number; name: string; startsOn: string; endsOn: string }[] }
    expect(sent.phases).toEqual([
      { number: 1, name: 'Pre-Launch', startsOn: '2026-10-01', endsOn: '2026-10-08' },
      // The second starts the day after the first ends, filled by the dialog.
      { number: 2, name: 'Week 1', startsOn: '2026-10-09', endsOn: '2026-10-15' },
    ])
    const id = rowId()
    // The phase is on the row as a chip, and in the dialog as the field that sets it.
    // The phase reads in the row's detail line on the merged work step.
    expect(screen.getByTestId(`wizard-work-piece-${id}`)).toHaveTextContent('Week 1')
    openPiece(id)
    expect((pieceField('phase') as HTMLSelectElement).value).toBe('2')
    fireEvent.click(screen.getByTestId('wizard-piece-cancel'))
    // ADR-0097 d.2: named by the catalogue entry, and still marked as proposed.
    expect(screen.getByTestId(`wizard-work-piece-${id}`)).toHaveTextContent('Reel')
    expect(screen.getByTestId(`wizard-work-proposed-${id}`)).toBeInTheDocument()
  })

  it('a row the model could not place in the catalogue blocks Next until a person chooses (ADR-0097 d.4)', async () => {
    proposeMutate.mockResolvedValue({
      ...proposal([{ name: 'a hologram in the mall', quantity: 1, typeCode: null, needsType: true, note: 'a hologram in the mall', channel: null, phaseNumber: null }]),
      needsType: 1,
    })
    toPhasesStep()
    // ADR-0097 d.5: the proposal screen says how many need a choice before the work step.
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.change(screen.getByTestId('wizard-brief-proposition'), { target: { value: 'Every purchase is a ticket.' } })
    chooseLanguage()
    await act(async () => { fireEvent.click(screen.getByTestId('wizard-next')) })
    expect(screen.getByTestId('wizard-work-status')).toHaveTextContent(/1 of them/i)
    const id = rowId()
    expect(screen.getByTestId(`wizard-work-warn-${id}`)).toBeInTheDocument()
    setOwner(id)
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-error')).toHaveTextContent(/catalogue/i)
    expect(screen.getByTestId('wizard-step-3')).toBeInTheDocument()

    // Choosing clears the flag, and the label follows the entry since it was only the note.
    openPiece(id)
    // The CODE is what tells two entries of the same name apart, so the picker is keyed by id.
    setPieceField('type', 't-vid-001')
    savePiece()
    expect(screen.queryByTestId(`wizard-work-warn-${id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`wizard-work-piece-${id}`)).toHaveTextContent('TVC')
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()
  })

  it('places an unplaced row by a due date inside exactly one phase, and the submit carries the phases', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'TVC', quantity: 1, typeCode: 'VID-001', needsType: false, note: null, channel: null, phaseNumber: null }]),
    )
    toPhasesStep()
    definePhases()
    await onToTheWork()
    const id = rowId()
    openPiece(id)
    expect((pieceField('phase') as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByTestId('wizard-piece-cancel'))
    setOwner(id)
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument()

    // Dates are counted back from each phase's end, so a piece nobody placed has no row and no
    // date — it is named on its own line, WITH the way to place it: its Edit, where a date inside
    // a phase puts it in that phase (Edward, 24 Sep). Week 1 runs 9–15 Oct.
    expect(screen.getByTestId('wizard-timing-unplaced')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId(`wizard-timing-place-${id}`))
    fireEvent.change(screen.getByTestId('wizard-timing-piece-due'), { target: { value: '2026-10-13' } })
    expect(screen.getByTestId('wizard-timing-piece-in-phase')).toHaveTextContent('Week 1')
    fireEvent.click(screen.getByTestId('wizard-timing-piece-save'))
    expect(screen.queryByTestId('wizard-timing-unplaced')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wizard-next'))
    expect(screen.getByTestId('wizard-step-5')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('wizard-review-approve'))
    const payload = submitMutate.mock.calls[0]![0] as {
      phases: { name: string; startsOn: string; endsOn: string }[]
      deliverables: { phaseNumber: number | null; dueAt: string | null }[]
    }
    expect(payload.phases).toEqual([
      expect.objectContaining({ name: 'Pre-Launch', endsOn: '2026-10-08' }),
      { name: 'Week 1', startsOn: '2026-10-09', endsOn: '2026-10-15' },
    ])
    expect(payload.deliverables[0]!.phaseNumber).toBe(2)
    // The date it goes up with is the one its phase gives it, counted back from the event —
    // not null, which is what an unplaced piece used to submit.
    expect(payload.deliverables[0]!.dueAt).toBeTruthy()
  })

  it('a campaign without phases submits none and no row carries one', async () => {
    proposeMutate.mockResolvedValue(
      proposal([{ name: 'TVC', quantity: 1, typeCode: 'VID-001', needsType: false, note: null, channel: null, phaseNumber: null }]),
    )
    toPhasesStep()
    await onToTheWork()
    const id = rowId()
    // No phases on the campaign means no phase chip on the row and no field in the dialog.
    expect(screen.getByTestId(`wizard-work-piece-${id}`)).not.toHaveTextContent(/Week|Phase/)
    setOwner(id)
    fireEvent.click(screen.getByTestId('wizard-next'))
    setDue('2026-10-12', id)
    fireEvent.click(screen.getByTestId('wizard-next'))
    fireEvent.click(screen.getByTestId('wizard-review-approve'))
    const payload = submitMutate.mock.calls[0]![0] as { phases: unknown[]; deliverables: { phaseNumber: number | null }[] }
    expect(payload.phases).toEqual([])
    expect(payload.deliverables[0]!.phaseNumber).toBeNull()
  })
})
