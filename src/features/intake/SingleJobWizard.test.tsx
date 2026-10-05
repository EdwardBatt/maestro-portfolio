import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endOfWorkingDay } from '../../lib/time/iraq'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import '../../lib/i18n'

/**
 * The single-job flow (ADR-0082 d.5; ADR-0083, 0084, 0085, 0086 SJ-A1). Every api module the
 * flow reaches is mocked with a self-contained factory — each one reaches `lib/supabase` →
 * `lib/env`, which throws in CI where no VITE_* exists (traps.md). No `importActual` anywhere.
 */

const state = vi.hoisted(() => ({
  /** ADR-0138 d.1: the brief's suggestion — nothing suggested unless a test says otherwise. */
  propose: vi.fn(async (_input: unknown) => ({ rows: [] as unknown[], groups: [] as unknown[], vocabulary: { types: 'offered', channels: 'offered' }, needsType: 0 })),
  startDraft: vi.fn(async (_input: unknown) => 'job-1'),
  updateDraft: vi.fn(async (_input: unknown) => undefined),
  complete: vi.fn(async (_input: unknown) => 'job-1'),
  saveBrief: vi.fn(async (_input: unknown) => undefined),
  similar: vi.fn(async () => [] as unknown[]),
  attach: vi.fn((_a: unknown, opts?: { onSuccess?: (id: string) => void }) => opts?.onSuccess?.('cmp-existing')),
  approve: vi.fn((_id: string, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => opts?.onSuccess?.()),
  saveReceipt: vi.fn(async () => undefined),
  fileDocuments: vi.fn(async () => [{ name: 'x', ok: true, assetId: 'asset-1' }]),
  ingest: vi.fn(async () => ({ fields: { task: 'Three statics for Ramadan', specs: '1080x1080' }, oversized: [] as string[] })),
  job: { data: null as unknown, isLoading: false, isSuccess: true },
  savedBrief: { data: null as unknown, isSuccess: true },
  savedReceipt: { data: null as unknown },
  leads: [{ id: 'lead-1', name: 'Fadia Wael', departmentId: 'dep-creative', teamId: null }],
  teamLeads: [] as { id: string; name: string; departmentId: string; teamId: string | null }[],
  /** SJ-v3-01: the tenant's templates, as the admin api hands them over. */
  templates: [
    { id: 'bt-exec', briefType: 'single_execution', nameEn: 'Execution Brief', nameAr: 'بريف تنفيذي', descriptionEn: 'One asset, already agreed.', descriptionAr: null, isActive: true,
      fields: [
        { key: 'deliverableType', en: 'Deliverable Type', ar: 'نوع المخرج', guidance: '2D, 3D, copy…' },
        { key: 'task', en: 'The Task', ar: 'المهمة', guidance: 'Describe exactly what is needed.' },
        { key: 'specs', en: 'Specs', ar: 'المواصفات', guidance: 'Sizes, format.' },
      ],
      departments: [{ id: 'dep-creative', name: 'Creative', isDefault: false }] },
    { id: 'bt-social', briefType: 'social_calendar', nameEn: 'Social Media Brief', nameAr: 'بريف السوشيال ميديا', descriptionEn: 'Posts, carousels, reels.', descriptionAr: null, isActive: true,
      fields: [
        { key: 'objective', en: 'Objective', ar: 'الهدف', guidance: '' }, { key: 'period', en: 'Period', ar: '', guidance: '' },
        { key: 'audience', en: 'Audience', ar: '', guidance: '' }, { key: 'tone', en: 'Tone', ar: '', guidance: '' },
        { key: 'platforms', en: 'Platforms', ar: '', guidance: '' },
      ], departments: [] },
    { id: 'bt-house', briefType: 'house_style', nameEn: 'House Style Brief', nameAr: null, descriptionEn: null, descriptionAr: null, isActive: true,
      fields: [{ key: 'notes', en: 'Notes', ar: '', guidance: '' }], departments: [] },
    { id: 'bt-empty', briefType: 'empty', nameEn: 'Empty Brief', nameAr: null, descriptionEn: null, descriptionAr: null, isActive: true, fields: [], departments: [] },
    { id: 'bt-off', briefType: 'retired', nameEn: 'Retired Brief', nameAr: null, descriptionEn: null, descriptionAr: null, isActive: false,
      fields: [{ key: 'a', en: 'A', ar: '', guidance: '' }], departments: [] },
  ],
  usage: { single_execution: { count: 3, lastCampaign: 'Ramadan 2026' } } as Record<string, { count: number; lastCampaign: string }>,
  /** The client's dos and don'ts (SJ-v3): Zeta has two on its profile. */
  rules: [{ kind: 'do', text: 'Arabic leads. English is never the master.' }, { kind: 'dont', text: 'Never “lottery”.' }] as { kind: 'do' | 'dont'; text: string }[],
}))

// ADR-0123 d.3: the client's working week — Iraq's here.
vi.mock('../../lib/calendar/client-calendar', () => ({
  useClientCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkCalendar: () => ({ calendar: { workingDays: [7, 1, 2, 3, 4] }, isLoading: false }),
  useWorkClientId: () => ({ clientId: null, isLoading: false }),
}))
vi.mock('../../lib/clients/people', () => ({ useClientPeople: () => ({ data: [] }), suggestedNames: () => [] }))
vi.mock('../dashboard/api/dashboard-data', () => ({ usePeopleNames: () => ({ data: new Map([['am-1', 'Mais Abdulkarim']]) }) }))
vi.mock('./api/intake-api', () => ({
  useDepartmentLeads: () => ({ data: state.leads }),
  useTeamLeads: () => ({ data: state.teamLeads }),
  useSingleExecutionTemplate: () => ({
    data: [
      { key: 'deliverableType', en: 'Deliverable Type', ar: 'نوع المخرج', guidance: '2D, 3D, copy…' },
      { key: 'task', en: 'The Task', ar: 'المهمة', guidance: 'Describe exactly what is needed.' },
      { key: 'specs', en: 'Specs', ar: 'المواصفات', guidance: 'Sizes, format.' },
    ],
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
  useStartSingleJobDraft: () => ({ mutateAsync: state.startDraft, isPending: false }),
  useCompleteSingleJobDraft: () => ({ mutateAsync: state.complete, isPending: false }),
  isNotDraft: (e: unknown) => (e as { code?: string } | null)?.code === '23514',
  useSaveSingleExecutionBrief: () => ({
    mutateAsync: state.saveBrief,
    // The autosave uses the callback form; it resolves through the same spy.
    mutate: (v: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) =>
      void state.saveBrief(v).then(() => opts?.onSuccess?.(), (e: unknown) => opts?.onError?.(e)),
    isPending: false,
  }),
  useSingleExecutionBrief: () => state.savedBrief,
  useIngestSingleExecution: () => ({ mutateAsync: state.ingest, isPending: false }),
  useSimilarOpenJobs: () => ({ mutateAsync: state.similar, isPending: false }),
  useAttachJobToCampaign: () => ({ mutate: state.attach, isPending: false }),
  useSingleJob: () => state.job,
  useClientBriefUsage: () => ({ data: state.usage }),
  useClientRules: () => ({ data: state.rules }),
}))
vi.mock('../admin/api/brief-templates-api', () => ({
  useBriefTemplates: () => ({ data: state.templates, isLoading: false, isError: false, isSuccess: true }),
}))

// ADR-0111 (I59.27): the tenant's own filler words — none here; the built-ins still warn.
vi.mock('../../lib/brief/filler-words-api', () => ({ useFillerWordList: () => [] }))
vi.mock('../../lib/settings/reminder-settings-api', () => ({
  useReminderSettings: () => ({ data: { briefApprovalHours: 24, assignmentEscalationHours: 24 } }),
}))
vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ claims: { tenantId: 't1' }, session: { user: { id: 'u1' } } }),
}))
vi.mock('../admin/api/admin-api', () => ({
  useDepartments: () => ({ data: [{ id: 'dep-creative', name: 'Creative' }, { id: 'dep-prod', name: 'Production' }] }),
}))
vi.mock('../../lib/brief/generate-deliverables', () => ({
  useGenerateDeliverables: () => ({ mutateAsync: state.propose, isPending: false }),
}))
vi.mock('../admin/api/deliverable-types-api', () => ({
  useDeliverableTypes: () => ({
    data: [
      { id: 'dt-static', code: 'SOC-001', categoryCode: 'SOC', nameEn: 'Social Static', nameAr: null, isActive: true },
      { id: 'dt-reel', code: 'SOC-004', categoryCode: 'SOC', nameEn: 'Reel', nameAr: null, isActive: true },
    ],
  }),
  // ADR-0117 d.3: adding a language the list lacks — resolves to a code made from the name.
  useAddLanguage: () => ({ mutateAsync: async (label: string) => label.toLowerCase(), isPending: false }),
  useAttributeValues: () => ({
    data: [
      { id: 'av1', attribute: 'channel', code: 'instagram', labelEn: 'Instagram', isActive: true },
      { id: 'av2', attribute: 'format', code: 'square', labelEn: 'Square', isActive: true },
      { id: 'av3', attribute: 'language', code: 'ar', labelEn: 'Arabic', isActive: true },
    ],
  }),
  useDeliverableCategories: () => ({
    data: [{ id: 'c-soc', code: 'SOC', nameEn: 'Social Media', nameAr: null, sortOrder: 10, isActive: true }],
  }),
}))
vi.mock('../campaigns/api/campaign-api', () => ({
  useUpdateCampaignDraft: () => ({ mutateAsync: state.updateDraft, isPending: false }),
  useWizardRefData: () => ({
    data: {
      clients: [{ id: 'c1', name: 'Zeta', accountManagerId: 'am-1' }],
      brands: [{ id: 'b1', name: 'Zeta KW', clientId: 'c1' }],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../campaigns/api/campaign-detail-api', () => ({
  useApproveCampaign: () => ({ mutate: state.approve, isPending: false }),
}))
vi.mock('../campaigns/api/document-filing-api', () => ({
  useFileDocuments: () => ({ mutate: vi.fn(), mutateAsync: state.fileDocuments, isPending: false }),
  fetchCampaignReferencesFolder: vi.fn(async () => 'f-refs'),
  receiptFile: (image: File) => image,
}))
vi.mock('../campaigns/api/brief-receipt-api', () => ({
  ReceiptReadRefusedError: class ReceiptReadRefusedError extends Error { code = 'forbidden' },
  useReadBriefReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  useReceiptTimeZones: () => ({ data: { mine: 'Asia/Baghdad', options: ['Asia/Baghdad'] } }),
  useBriefReceipt: () => state.savedReceipt,
  useSaveBriefReceipt: () => ({ mutateAsync: state.saveReceipt, isPending: false }),
  instantFrom: (date: string, time: string) => (date && time ? `${date}T${time}:00.000Z` : null),
  wallClockIn: () => ({ date: '', time: '' }),
}))
vi.mock('../campaigns/api/brief-ingest-api', () => ({
  BriefTooLongError: class BriefTooLongError extends Error { code = 'too_long' },
  BriefIngestRefusedError: class BriefIngestRefusedError extends Error { code = 'forbidden' },
  useIngestBrief: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../library/api/library-api', () => ({
  fetchAssetDownloadUrl: vi.fn(async () => 'https://example.test/signed'),
  useFolderAssets: () => ({ data: [] }),
}))
vi.mock('../../lib/assets/folders', () => ({
  useCampaignFolderRoot: () => ({ data: null }),
  useFolderView: () => ({ data: undefined, isLoading: false, isError: false, isPlaceholderData: false }),
  useCreateFolder: () => ({ mutate: vi.fn(), isPending: false }),
  useInvalidateFolders: () => vi.fn(),
  isDuplicateFolderName: () => false,
}))
vi.mock('../../lib/brands', () => ({
  useCreateBrand: () => ({ mutate: vi.fn(), isPending: false }),
  isDuplicateBrandName: () => false,
}))
vi.mock('../team/api/team-api', () => ({
  useTeamLoad: () => ({
    week: { start: '', end: '', label: '14 Sep – 20 Sep' },
    groups: [
      {
        key: 'department:Creative', label: 'Creative', kind: 'department',
        people: [{ id: 'r1', departmentId: 'dep-creative', bookedHours: 30, nominalHours: 40, level: 'ok' }],
      },
    ],
    isLoading: false,
    isError: false,
  }),
  capacityLevel: (pct: number) => (pct >= 120 ? 'over' : pct >= 100 ? 'warn' : 'ok'),
}))

import { SingleJobWizard } from './SingleJobWizard'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
}

function renderWizard(path = '/campaigns/new-job') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/campaigns/new-job" element={<><SingleJobWizard /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

/** SJ-v3-01 answered — the client, the evidence, the words, the kind of brief — and left. The
 *  draft is created on that Next, under a provisional name. */
async function toBrief(briefType = 'single_execution') {
  type('sj-client', 'c1')
  type('sj-asked-by', 'Ahmed')
  type('sj-source', 'whatsapp')
  type('sj-words', 'we need three teaser posts before Thursday')
  fireEvent.click(screen.getByTestId(`sj-brief-card-${briefType}`))
  fireEvent.click(screen.getByTestId('sj-next'))
  await screen.findByTestId('sj-brief')
}

/** SJ-v3-02's one required field written, and on to who and when. */
async function toRequest(briefType = 'single_execution') {
  await toBrief(briefType)
  type(briefType === 'single_execution' ? 'sj-field-task' : 'sj-field-objective', 'Three statics, Ramadan teaser, Zeta KW')
  fireEvent.click(screen.getByTestId('sj-next'))
  await screen.findByTestId('sj-request')
}

/** ADR-0117 addendum (Q19, 4 Oct): a job is made in at least one language — picked, never assumed. */
function pickLanguage(code = 'ar') {
  fireEvent.change(screen.getByTestId('sj-languages-picker-input'), { target: { value: 'Ara' } })
  fireEvent.mouseDown(screen.getByTestId(`sj-languages-picker-option-${code}`))
}

/** Who and when filled in enough to leave it. */
function fillRequest() {
  type('sj-title', 'Ramadan teaser posts')
  type('sj-quantity', '3')
  type('sj-due', '2027-03-11')
  fireEvent.click(screen.getByTestId('sj-department-dep-creative'))
  pickLanguage()
}

async function toReview() {
  await toRequest()
  fillRequest()
  fireEvent.click(screen.getByTestId('sj-next'))
  await screen.findByTestId('sj-review')
}

describe('SingleJobWizard — SJ-v3-01 what are we making? (Figma B · SINGLE JOB — BRIEF FIRST, 22 Sep)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
  })

  it('opens on the kind of brief, with the four-step rail, the client first, and the evidence beside it', () => {
    renderWizard()
    expect(screen.getByTestId('sj-brief-type')).toBeInTheDocument()
    // The evidence row (ADR-0083 d.1/d.2/d.5) sits beside "For whom", the clock not started.
    expect(screen.getByTestId('sj-evidence')).toContainElement(screen.getByTestId('sj-asked-by'))
    expect(screen.getByTestId('sj-evidence')).toContainElement(screen.getByTestId('brief-receipt'))
    expect(screen.getByTestId('sj-clock')).toHaveTextContent(/has not started/i)
    expect(screen.getByTestId('sj-step-dot-1')).toHaveTextContent('Type of brief')
    expect(screen.getByTestId('sj-step-dot-4')).toHaveTextContent('Review')
    expect(screen.getByTestId('sj-brand')).toBeDisabled()
    // Greyed until a brief is picked (Edward, 26 Sep).
    expect(screen.getByTestId('sj-next')).toHaveTextContent('Start the brief')
    expect(screen.getByTestId('sj-next')).toBeDisabled()
  })

  it('shows every usable template as a card — the tenant\'s own list, not a fixed six', () => {
    renderWizard()
    // Active with fields: shown, incl. a template the tenant made (no known icon, no Arabic).
    expect(screen.getByTestId('sj-brief-card-single_execution')).toBeInTheDocument()
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toBeInTheDocument()
    expect(screen.getByTestId('sj-brief-card-house_style')).toBeInTheDocument()
    // No fields → unselectable (ADR-0048 d.2); inactive → gone.
    expect(screen.queryByTestId('sj-brief-card-empty')).toBeNull()
    expect(screen.queryByTestId('sj-brief-card-retired')).toBeNull()
    const exec = screen.getByTestId('sj-brief-card-single_execution')
    expect(exec).toHaveTextContent('Execution Brief')
    expect(exec).toHaveTextContent('بريف تنفيذي')
    expect(exec).toHaveTextContent('One asset, already agreed.')
    expect(exec).toHaveTextContent('Creative')
    expect(exec).toHaveTextContent('3 fields')
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toHaveTextContent('No department yet')
  })

  it('says where the client last had each kind of brief once a client is chosen', () => {
    renderWizard()
    expect(screen.getByTestId('sj-brief-card-single_execution')).not.toHaveTextContent('Ramadan 2026')
    type('sj-client', 'c1')
    expect(screen.getByTestId('sj-brief-card-single_execution')).toHaveTextContent('Ramadan 2026 · 3 briefs')
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toHaveTextContent('Not used for Zeta yet')
    // INHERITS: the client profile's two rules and the library come with the choice.
    expect(screen.getByTestId('sj-inherits')).toHaveTextContent('2 dos-and-don’ts rules and the Zeta library come with this choice.')
  })

  it('the search narrows the cards and an empty match is a line, not a dead end', () => {
    renderWizard()
    type('sj-brief-search', 'social')
    expect(screen.queryByTestId('sj-brief-card-single_execution')).toBeNull()
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toBeInTheDocument()
    type('sj-brief-search', 'zzz')
    expect(screen.getByTestId('sj-brief-empty')).toHaveTextContent('Nothing matches')
    type('sj-brief-search', '')
    expect(screen.getByTestId('sj-brief-card-house_style')).toBeInTheDocument()
  })

  it('a pressed card is the choice, and Next is named after it', () => {
    renderWizard()
    fireEvent.click(screen.getByTestId('sj-brief-card-social_calendar'))
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('sj-brief-card-single_execution')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('sj-next')).toHaveTextContent('Start the Social Media Brief')
  })

  it('is greyed until a brief is picked, then refuses without a client and the words, naming both', () => {
    renderWizard()
    expect(screen.getByTestId('sj-next')).toBeDisabled()
    fireEvent.click(screen.getByTestId('sj-brief-card-single_execution'))
    fireEvent.click(screen.getByTestId('sj-next'))
    const err = screen.getByTestId('sj-error')
    expect(err).toHaveTextContent('Client')
    expect(err).toHaveTextContent('What they asked for')
    expect(screen.getByTestId('sj-client')).toHaveAttribute('aria-invalid', 'true')
    expect(state.startDraft).not.toHaveBeenCalled()
  })

  it('moves to the brief with the choice kept — creating the draft under a provisional name — and Back returns to it', async () => {
    renderWizard()
    await toBrief('social_calendar')
    expect(state.startDraft).toHaveBeenCalledTimes(1)
    expect(state.startDraft).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'c1', name: expect.stringMatching(/^Zeta · Social Media Brief · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [a-z0-9]{4}$/),
    }))
    fireEvent.click(screen.getByTestId('sj-back'))
    expect(screen.getByTestId('sj-brief-card-social_calendar')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('sj-client')).toHaveValue('c1')
  })

  it('offers the campaign wizard for more than one deliverable', () => {
    renderWizard()
    expect(screen.getByTestId('sj-start-campaign')).toHaveAttribute('href', '/campaigns/new')
  })

  it('stores the kind of brief with the request when the draft is written', async () => {
    renderWizard()
    await toBrief()
    expect(state.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      brief: expect.objectContaining({ request: expect.objectContaining({ briefType: 'single_execution' }) }),
    }))
  })
})

describe('SingleJobWizard — SJ-02 the request (ADR-0083)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
  })

  it('opens on the request screen with the clock not started', async () => {
    renderWizard()
    await toRequest()
    expect(screen.getByTestId('sj-request')).toBeInTheDocument()
    expect(screen.getByTestId('sj-clock')).toHaveTextContent(/has not started/i)
  })

  it('refuses to move on and NAMES every missing mandatory field (B1)', async () => {
    renderWizard()
    await toRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    // Not a generic "marked *" line — the actual fields, so the user knows what to fill.
    const err = screen.getByTestId('sj-error')
    expect(err).toHaveTextContent('Job title')
    expect(err).toHaveTextContent('Which department')
    expect(state.saveBrief).not.toHaveBeenCalled()
    expect(screen.getByTestId('sj-title')).toHaveAttribute('aria-invalid', 'true')
  })

  it('offers the six sources as a fixed list, with an internal request among them (d.5) — on screen 1 since 22 Sep', () => {
    renderWizard()
    const options = within(screen.getByTestId('sj-source')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['—', 'WhatsApp', 'Email', 'Phone call', 'Meeting', 'Internal request', 'Other'])
  })

  // d.8/d.9: a department is chosen, never a person; its lead is the owner.
  it('names the department lead as the owner, with the department load for the week it is due (d.8, d.10)', async () => {
    renderWizard()
    await toRequest()
    expect(screen.queryByTestId('sj-owner')).toBeNull()
    type('sj-due', '2027-03-11')
    fireEvent.click(screen.getByTestId('sj-department-dep-creative'))
    expect(screen.getByTestId('sj-owner-name')).toHaveTextContent('Fadia Wael')
    expect(screen.getByTestId('sj-owner-load')).toHaveTextContent('Creative is at 75% for the week it is due (14 Sep – 20 Sep)')
  })

  it('says so when a department has no lead, and still allows the job (warn-and-allow)', async () => {
    renderWizard()
    await toRequest()
    fireEvent.click(screen.getByTestId('sj-department-dep-prod'))
    expect(screen.getByTestId('sj-owner-none')).toHaveTextContent(/no department lead/i)
  })

  // ADR-0138 (I73.3): the brief suggests what the job makes; a piece for another department is allowed, owned
  // there, with a warning that it reads like a campaign.
  it('fills what the brief suggests on reaching who and when, and warns when the pieces span departments', async () => {
    state.propose.mockResolvedValueOnce({
      rows: [
        { name: 'Social Static', quantity: 3, typeCode: 'SOC-001', needsType: false, note: null, channel: 'instagram', phaseNumber: null, group: 0 },
        { name: 'Reel', quantity: 1, typeCode: 'SOC-004', needsType: false, note: null, channel: null, phaseNumber: null, group: 1 },
      ],
      groups: [{ name: null, departmentId: 'dep-creative' }, { name: null, departmentId: 'dep-prod' }],
      vocabulary: { types: 'offered', channels: 'offered' },
      needsType: 0,
    })
    renderWizard()
    await toRequest()
    expect(state.propose).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('sj-suggestion')).toHaveTextContent(/Suggested from the brief/)
    expect(screen.getByTestId('sj-quantity')).toHaveValue(3)
    expect(screen.getByTestId('sj-more-suggested-0')).toBeInTheDocument()
    expect(screen.getByTestId('sj-more-department-0')).toHaveValue('dep-prod')
    expect(screen.getByTestId('sj-reads-like-campaign')).toHaveTextContent(/more than one department/)
    // A person's change makes the row theirs.
    fireEvent.change(screen.getByTestId('sj-more-quantity-0'), { target: { value: '2' } })
    expect(screen.queryByTestId('sj-more-suggested-0')).not.toBeInTheDocument()
  })

  it('says so when the brief suggests nothing, and asks only once', async () => {
    renderWizard()
    await toRequest()
    expect(await screen.findByTestId('sj-suggestion')).toHaveTextContent(/did not name anything/)
    expect(state.propose).toHaveBeenCalledTimes(1)
  })

  // The type is optional (ADR-0051 d.7) and the cost of leaving it out is said.
  it('says what leaving the type blank costs', async () => {
    renderWizard()
    await toRequest()
    expect(screen.getByTestId('sj-type-none')).toHaveTextContent(/no task list is generated/i)
  })

  // ADR-0085 d.8: the job exists from Next on SJ-02, as a DRAFT of kind single_job (ADR-0086 d.8),
  // and the request lands in `campaigns.brief` the way the wizard saves its own steps.
  it('names the draft on Next from who and when, saves the request into it with the lead as owner, and files the brief row', async () => {
    renderWizard()
    await toReview()
    // The draft was created on screen 1 (provisionally named); who and when renames it.
    expect(state.startDraft).toHaveBeenCalledTimes(1)
    expect(state.startDraft).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', brandId: null, accountManagerId: 'am-1' }))
    const arg = state.updateDraft.mock.lastCall![0] as unknown as Record<string, unknown>
    expect(arg).toMatchObject({ campaignId: 'job-1', name: 'Ramadan teaser posts', accountManagerId: 'am-1', goLiveAt: null })
    const brief = arg.brief as Record<string, unknown>
    expect(brief.kind).toBe('single_job')
    expect(brief.request).toEqual({ askedBy: 'Ahmed', source: 'whatsapp', words: 'we need three teaser posts before Thursday', briefType: 'single_execution', priority: null, reducedScope: false })
    expect(brief.deliverables).toEqual([
      expect.objectContaining({ name: 'Ramadan teaser posts', ownerUserId: 'lead-1', dueAt: '2027-03-11', quantity: 3, departmentId: 'dep-creative' }),
    ])
    expect(state.saveBrief).toHaveBeenLastCalledWith(expect.objectContaining({ campaignId: 'job-1', departmentId: 'dep-creative', briefType: 'single_execution' }))
    // Nothing is completed yet: the stream and the deliverable row are written at release.
    expect(state.complete).not.toHaveBeenCalled()
  })

  it('reports a duplicate title as such rather than as a generic failure', async () => {
    renderWizard()
    await toRequest()
    // The title is written on this screen's Next; a taken one is the unique-name refusal.
    state.updateDraft.mockRejectedValueOnce({ code: '23505' })
    fillRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    expect(await screen.findByTestId('sj-error')).toHaveTextContent(/already/i)
    expect(screen.getByTestId('sj-request')).toBeInTheDocument()
  })

  it('corrects the job in place when coming back and pressing Next again, and locks the client', async () => {
    renderWizard()
    await toReview()
    fireEvent.click(screen.getByTestId('sj-back'))
    await screen.findByTestId('sj-request')
    fireEvent.click(screen.getByTestId('sj-back'))
    await screen.findByTestId('sj-brief')
    // The client lives on the first screen and is locked there once the job exists.
    fireEvent.click(screen.getByTestId('sj-back'))
    expect(screen.getByTestId('sj-client')).toBeDisabled()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-brief')
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-request')
    type('sj-title', 'Ramadan teaser posts v2')
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-review')
    expect(state.startDraft).toHaveBeenCalledTimes(1)
    expect(state.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({ campaignId: 'job-1', name: 'Ramadan teaser posts v2' }))
  })
})

describe('SingleJobWizard — SJ-v3-04 who and when, S2 under the lead time (22 Sep)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
  })

  it('is the Figma\'s screen: which team, the lead row with the load, when with the count-back, priority, and what is being made', async () => {
    renderWizard()
    await toRequest()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Who makes it, and when do they need it by?')
    expect(screen.getByTestId('sj-panel-job')).toHaveTextContent('Which team')
    fireEvent.click(screen.getByTestId('sj-department-dep-creative'))
    expect(screen.getByTestId('sj-owner')).toHaveTextContent('Fadia Wael · Department lead')
    expect(screen.getByTestId('sj-owner-load')).toHaveTextContent('Team at 75%')
    // The Figma's line, true since ADR-0045's first rung was built: the lead's name, the tenant's hours —
    // opening, since 27 Sep (Edward), with what the drop-down is for.
    expect(screen.getByTestId('sj-escalation-note')).toHaveTextContent('Assign the deliverable’s owner. If Fadia Wael has not assigned it within 24 hours it escalates to the traffic manager on its own.')
    // The count-back strip appears with a date: 4 working days (no type chosen), start to due.
    //
    // START MOVED Sun 7 Mar → Mon 8 Mar (Edward, 24 Sep, `I56.11`): the count-back is INCLUSIVE,
    // so four working days due Thursday the 11th are 8, 9, 10 and 11 March. The strip used to
    // begin a day earlier than the campaign timing screen did for the same four days.
    type('sj-due', '2027-03-11') // a Thursday
    expect(screen.getByTestId('sj-countback')).toHaveTextContent('Maestro counted it back for you')
    expect(screen.getByTestId('sj-day-2027-03-08')).toHaveTextContent('starts') // Monday
    expect(screen.getByTestId('sj-day-2027-03-11')).toHaveTextContent('due')
    expect(screen.getByTestId('sj-day-2027-03-12')).toHaveTextContent('weekend')
    expect(screen.getByTestId('sj-countback-note')).toHaveTextContent('needs 4 working days')
    fireEvent.click(screen.getByTestId('sj-priority-high'))
    expect(screen.getByTestId('sj-priority-high')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('sj-panel-what')).toContainElement(screen.getByTestId('sj-title'))
  })

  it('a due date short of the lead time is NOT a block: S2 says by how much, Continue tags the job reduced scope, More time goes back', async () => {
    renderWizard()
    await toRequest()
    type('sj-title', 'Rush job')
    // Today is the test's real day; a due date in the past leaves zero working days.
    type('sj-due', '2026-01-08')
    fireEvent.click(screen.getByTestId('sj-department-dep-creative'))
    pickLanguage()
    fireEvent.click(screen.getByTestId('sj-next'))
    const dialog = await screen.findByTestId('sj-short-dialog')
    expect(dialog).toHaveTextContent('Not a block')
    expect(dialog).toHaveTextContent('4 days short')
    expect(screen.getByTestId('sj-short-has')).toHaveTextContent('0 working days')
    expect(screen.getByTestId('sj-short-by')).toHaveTextContent('4 days')
    expect(state.saveBrief).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sj-short-more-time'))
    expect(screen.queryByTestId('sj-short-dialog')).toBeNull()
    expect(screen.getByTestId('sj-request')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-short-dialog')
    fireEvent.click(screen.getByTestId('sj-short-continue'))
    await screen.findByTestId('sj-review')
    expect(screen.getByTestId('sj-review-reduced-scope')).toHaveTextContent('Reduced scope')
    expect(state.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      brief: expect.objectContaining({ request: expect.objectContaining({ reducedScope: true }) }),
    }))
  })
})

describe('SingleJobWizard — SJ-03 the brief (ADR-0084)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
  })

  it('is titled after the chosen template, keeps the request words in view, and splits the fields into essentials and the rest (SJ-v3-02)', async () => {
    renderWizard()
    await toBrief()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Execution Brief')
    expect(screen.getByTestId('sj-brief-template-tag')).toHaveTextContent('بريف تنفيذي · 3 fields · from the live template')
    expect(screen.getByTestId('sj-brief-words')).toHaveTextContent('we need three teaser posts before Thursday')
    expect(screen.getByTestId('sj-brief-words').parentElement).toHaveTextContent('asked by Ahmed')
    // Three fields → all essentials, the rest empty; the counts say so on the rail and the sections.
    expect(screen.getByTestId('sj-brief-essentials')).toContainElement(screen.getByTestId('sj-field-task'))
    expect(screen.getByTestId('sj-brief-essentials')).toContainElement(screen.getByTestId('sj-field-specs'))
    expect(screen.getByTestId('sj-brief-nav-essentials')).toHaveTextContent('0 of 3')
    expect(screen.getByTestId('sj-brief-nav-rest')).toHaveTextContent('0 of 0')
    // Nothing is prefilled (d.5); the guidance is the placeholder.
    expect(screen.getByTestId('sj-field-task')).toHaveValue('')
    expect(screen.getByTestId('sj-field-task')).toHaveAttribute('placeholder', 'Describe exactly what is needed.')
    // The client's dos and don'ts, locked, with where they come from.
    expect(screen.getByTestId('sj-brief-nav-rules')).toHaveTextContent('inherited · 2')
    expect(screen.getByTestId('sj-brief-rules-list')).toHaveTextContent('Arabic leads. English is never the master.')
    expect(screen.getByTestId('sj-brief-rules')).toHaveTextContent('From Zeta. They travel with this deliverable; you cannot edit them here.')
    expect(screen.getByTestId('sj-brief-usage')).toHaveTextContent('Ramadan 2026 · 3 briefs for Zeta used this.')
    type('sj-field-task', 'x')
    expect(screen.getByTestId('sj-brief-nav-essentials')).toHaveTextContent('1 of 3')
  })

  it('writes the brief from the template chosen on screen 1 — its fields, its required field, its type', async () => {
    renderWizard()
    await toBrief('social_calendar')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Social Media Brief')
    expect(screen.getByTestId('sj-brief-essentials')).toContainElement(screen.getByTestId('sj-field-objective'))
    expect(screen.getByTestId('sj-brief-rest')).toContainElement(screen.getByTestId('sj-field-platforms'))
    expect(screen.queryByTestId('sj-field-task')).toBeNull()
    // No Task on this template: its first field is the one it cannot go without.
    fireEvent.click(screen.getByTestId('sj-next'))
    expect(await screen.findByTestId('sj-error')).toHaveTextContent(/Objective/)
    fireEvent.click(screen.getByTestId('sj-error-close'))
    type('sj-field-objective', 'Awareness')
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-request')
    fillRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-review')
    expect(state.saveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefType: 'social_calendar', values: expect.objectContaining({ objective: 'Awareness' }) }))
  })

  it('requires The Task and nothing else (d.6a)', async () => {
    renderWizard()
    await toBrief()
    fireEvent.click(screen.getByTestId('sj-next'))
    expect(await screen.findByTestId('sj-error')).toHaveTextContent(/The Task/)
    expect(state.saveBrief).not.toHaveBeenCalled()
  })

  it('saves the six fields and the reminder as one single_execution brief for the department (d.3, d.8)', async () => {
    renderWizard()
    await toBrief()
    type('sj-field-task', 'Three statics')
    type('sj-risk', 'waiting on the client logo')
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-request')
    fillRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-review')
    expect(state.saveBrief).toHaveBeenCalledWith({
      campaignId: 'job-1',
      departmentId: 'dep-creative',
      briefType: 'single_execution',
      // The rules ride with the brief, snapshotted, so the department reads what the AM saw.
      values: { task: 'Three statics', whatCouldStopThis: 'waiting on the client logo', inheritedRules: JSON.stringify(state.rules) },
    })
  })

  it('autosaves the brief while it is typed, and says so (SJ-v3-02 "Autosaved")', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderWizard()
      await toBrief()
      expect(screen.queryByTestId('sj-brief-save-state')).toBeNull()
      type('sj-field-task', 'Three statics')
      await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
      // No department yet → into the draft, not a campaign_briefs row.
      expect(state.saveBrief).not.toHaveBeenCalled()
      expect(state.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({
        brief: expect.objectContaining({ briefValues: expect.objectContaining({ task: 'Three statics' }) }),
      }))
      expect(screen.getByTestId('sj-brief-save-state')).toHaveTextContent('Saved')
    } finally {
      vi.useRealTimers()
    }
  })

  // d.6: after ingestion the fields are filled and editable, and Next waits until each is seen.
  it('fills empty fields from a document, marks them, and holds Next until each is kept or edited', async () => {
    renderWizard()
    await toBrief()
    type('sj-field-specs', 'typed by hand')
    fireEvent.click(screen.getByTestId('brief-ingest-toggle-mode'))
    type('brief-ingest-paste', 'Task: three statics for Ramadan. Specs: 1080x1080.')
    await act(async () => { fireEvent.click(screen.getByTestId('brief-ingest-run')) })
    await screen.findByTestId('sj-filled-mark-task')
    expect(screen.getByTestId('sj-field-task')).toHaveValue('Three statics for Ramadan')
    // What a person typed is never overwritten.
    expect(screen.getByTestId('sj-field-specs')).toHaveValue('typed by hand')
    expect(screen.queryByTestId('sj-filled-mark-specs')).toBeNull()
    expect(screen.getByTestId('sj-unreviewed')).toHaveTextContent('1 field(s)')
    // The button is no longer dead-disabled: clicking with a field still unconfirmed says why
    // (a modal) instead of doing nothing (found 12 Sep).
    fireEvent.click(screen.getByTestId('sj-next'))
    expect(await screen.findByTestId('sj-review-blocked')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sj-review-blocked-close'))
    // Confirm the field, and Next now advances to who and when.
    fireEvent.click(screen.getByTestId('sj-filled-keep-task'))
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-request')
  })

  it('a document read against one template does not hold Next hostage after another template is picked (22 Sep)', async () => {
    renderWizard()
    await toBrief()
    fireEvent.click(screen.getByTestId('brief-ingest-toggle-mode'))
    type('brief-ingest-paste', 'Task: three statics for Ramadan. Specs: 1080x1080.')
    await act(async () => { fireEvent.click(screen.getByTestId('brief-ingest-run')) })
    await screen.findByTestId('sj-filled-mark-task')
    // Back to screen 1, a different kind of brief, forward again: no marker is on screen, so
    // nothing is waiting for Keep and Next must not refuse.
    fireEvent.click(screen.getByTestId('sj-back'))
    fireEvent.click(screen.getByTestId('sj-brief-card-social_calendar'))
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-brief')
    expect(screen.queryByTestId('sj-unreviewed')).toBeNull()
    expect(screen.queryByTestId('sj-filled-mark-task')).toBeNull()
    type('sj-field-objective', 'Awareness')
    fireEvent.click(screen.getByTestId('sj-next'))
    expect(screen.queryByTestId('sj-review-blocked')).toBeNull()
    await screen.findByTestId('sj-request')
  })
})

describe('SingleJobWizard — SJ-04 review and approve (ADR-0085), SJ-A1 (ADR-0086)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
  })

  it('shows everything read-only with Edit links back to each screen, and says where it goes', async () => {
    renderWizard()
    await toReview()
    expect(screen.getByTestId('sj-review-title')).toHaveTextContent('Ramadan teaser posts')
    expect(screen.getByTestId('sj-review-words')).toHaveTextContent('we need three teaser posts before Thursday')
    expect(screen.getByTestId('sj-review-field-task')).toHaveTextContent('Three statics, Ramadan teaser, Zeta KW')
    expect(screen.getByTestId('sj-review-where')).toHaveTextContent(/Creative\. Fadia Wael is the lead/)
    expect(screen.getByTestId('sj-review-rules-list')).toHaveTextContent('Never “lottery”.')
    expect(screen.getByTestId('sj-review-rules')).toHaveTextContent('From Zeta. 2 rules travel with every deliverable.')
    // No promote box, no client-view panel (d.6, d.7).
    expect(screen.queryByText(/promote/i)).toBeNull()
    expect(screen.queryByText(/what .* sees/i)).toBeNull()
    fireEvent.click(screen.getByTestId('sj-review-edit-brief'))
    expect(screen.getByTestId('sj-brief')).toBeInTheDocument()
  })

  // ADR-0085 d.2: one press — complete the draft (stream, deliverable, held tasks), then approve.
  it('the duplicate check runs on Next from who and when (S1); Open completes then approves the job and opens it', async () => {
    renderWizard()
    await toReview()
    // S1 ran on the way here, once the title was known — not on Open.
    expect(state.similar).toHaveBeenCalledWith({ clientId: 'c1', title: 'Ramadan teaser posts', excludeCampaignId: 'job-1' })
    state.similar.mockClear()
    fireEvent.click(screen.getByTestId('sj-approve'))
    await waitFor(() => expect(state.approve).toHaveBeenCalledWith('job-1', expect.anything()))
    expect(state.similar).not.toHaveBeenCalled()
    expect(state.complete).toHaveBeenCalledTimes(1)
    expect(state.complete).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'job-1',
      // the due DAY lands at the close of the working day in Iraq (ADR-0076 d.3), not midnight UTC
      deliverables: [{ name: 'Ramadan teaser posts', ownerUserId: 'lead-1', dueAt: endOfWorkingDay('2027-03-11').toISOString(), deliverableTypeId: null, quantity: 3, channel: null, format: null, priority: null }],
    }))
    expect(state.complete.mock.invocationCallOrder[0]!).toBeLessThan(state.approve.mock.invocationCallOrder[0]!)
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns/job-1')
  })

  // ADR-0085 d.3: the check warns, never refuses — and a check that cannot run is not a refusal
  // either (review, 11 Sep: the first build held the release hostage to pg_trgm).
  it('goes on to the review when the duplicate check itself fails, and says so once after opening the job', async () => {
    state.similar.mockRejectedValueOnce(new Error('similarity() does not exist'))
    renderWizard()
    await toReview()
    fireEvent.click(screen.getByTestId('sj-approve'))
    await waitFor(() => expect(state.approve).toHaveBeenCalledWith('job-1', expect.anything()))
    const note = await screen.findByTestId('sj-similar-skipped')
    expect(note).toHaveTextContent(/could not run/i)
    fireEvent.click(screen.getByTestId('sj-similar-skipped-close'))
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns/job-1')
  })

  it('a retry after a failed approval does not complete the draft twice', async () => {
    state.approve.mockImplementationOnce((_id, opts) => opts?.onError?.({ code: 'XX000' }))
    renderWizard()
    await toReview()
    fireEvent.click(screen.getByTestId('sj-approve'))
    await screen.findByTestId('sj-error')
    fireEvent.click(screen.getByTestId('sj-error-close'))
    fireEvent.click(screen.getByTestId('sj-approve'))
    await waitFor(() => expect(state.approve).toHaveBeenCalledTimes(2))
    expect(state.complete).toHaveBeenCalledTimes(1)
  })

  it('shows S1 on Next from who and when when a similar open job exists, with the score; Keep them separate goes on to the review', async () => {
    state.similar.mockResolvedValue([
      {
        campaignId: 'cmp-existing', name: 'Ramadan teaser post', score: 0.92, kind: 'single_job',
        departmentNames: ['Creative'], deliverableCount: 1, raisedBy: 'Lina', raisedAt: '2026-09-04T09:00:00Z', status: 'approved',
      },
    ])
    renderWizard()
    await toRequest()
    fillRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-similar-dialog')
    expect(screen.queryByTestId('sj-review')).toBeNull()
    expect(state.approve).not.toHaveBeenCalled()
    expect(screen.getByTestId('sj-similar-score-cmp-existing')).toHaveTextContent('92% match')
    expect(screen.getByTestId('sj-similar-why')).toHaveTextContent('one conversation with Ahmed')
    fireEvent.click(screen.getByTestId('sj-similar-separate'))
    await screen.findByTestId('sj-review')
    fireEvent.click(screen.getByTestId('sj-approve'))
    await waitFor(() => expect(state.approve).toHaveBeenCalledWith('job-1', expect.anything()))
  })

  it('Add as a deliverable attaches the draft to that job and opens it', async () => {
    state.similar.mockResolvedValue([
      { campaignId: 'cmp-existing', name: 'Ramadan teaser post', score: 0.8, kind: 'campaign', departmentNames: [], deliverableCount: 4, raisedBy: null, raisedAt: null, status: 'approved' },
    ])
    renderWizard()
    await toRequest()
    fillRequest()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-similar-dialog')
    fireEvent.click(screen.getByTestId('sj-similar-attach'))
    // Completed first, so there is a deliverable ROW to move onto the other job (d.5).
    await waitFor(() => expect(state.attach).toHaveBeenCalledWith({ draftCampaignId: 'job-1', targetCampaignId: 'cmp-existing' }, expect.anything()))
    expect(state.complete).toHaveBeenCalledTimes(1)
    expect(state.approve).not.toHaveBeenCalled()
    // The wizard navigates inside the attach's onSuccess, so the address arrives a tick after the
    // call does — waited for, not read straight away (it failed only under a parallel run).
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/campaigns/cmp-existing'))
  })

  // d.8: Cancel leaves a draft; it says so, and nothing changes its status.
  it('Cancel after the draft exists says it stays under Drafts, and leaves without completing or approving', async () => {
    renderWizard()
    await toReview()
    fireEvent.click(screen.getByTestId('sj-cancel'))
    expect(screen.getByTestId('sj-cancel-message')).toHaveTextContent(/does not release it/i)
    expect(screen.getByTestId('sj-cancel-detail')).toHaveTextContent(/under Drafts/i)
    fireEvent.click(screen.getByTestId('sj-cancel-confirm'))
    expect(state.complete).not.toHaveBeenCalled()
    expect(state.approve).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns')
  })

  it('Cancel before anything exists simply returns to the list', () => {
    renderWizard()
    fireEvent.click(screen.getByTestId('sj-cancel'))
    expect(screen.getByTestId('where')).toHaveTextContent('/campaigns')
  })
})

describe('SingleJobWizard — resuming an unreleased job (ADR-0085 d.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
  })

  it('opens a draft with a brief on review, with what was captured', async () => {
    state.job = {
      data: {
        id: 'job-9', name: 'Eid KV', status: 'draft', kind: 'single_job', clientId: 'c1', brandId: 'b1', accountManagerId: 'am-1',
        brief: {
          kind: 'single_job',
          request: { askedBy: 'Ahmed', source: 'email', words: 'one KV for Eid' },
          deliverables: [{ name: 'Eid KV', ownerUserId: 'lead-1', departmentId: 'dep-creative', dueAt: '2026-09-20', deliverableTypeId: 'dt-static', quantity: 1, channel: null, format: null }],
        },
      },
      isLoading: false,
      isSuccess: true,
    }
    state.savedBrief = { data: { id: 'brief-9', departmentId: 'dep-creative', values: { task: 'One KV', whatCouldStopThis: 'logo' }, approvedAt: null }, isSuccess: true }
    renderWizard('/campaigns/new-job?job=job-9')
    await screen.findByTestId('sj-review')
    expect(screen.getByTestId('sj-review-title')).toHaveTextContent('Eid KV')
    expect(screen.getByTestId('sj-review-words')).toHaveTextContent('one KV for Eid')
    expect(screen.getByTestId('sj-review-field-task')).toHaveTextContent('One KV')
    expect(screen.getByTestId('sj-review-field-whatCouldStopThis')).toHaveTextContent('logo')
  })

  // I66.12: a job already sent for approval is not a draft; the database refuses every draft save on it. Reopened, it
  // says who it waits for, stays on review, offers no Back into a step that would save, and saves nothing.
  it('keeps a job already sent for approval on review, says who it waits for, and saves nothing', async () => {
    state.job = {
      data: {
        id: 'job-9', name: 'Harmony Oct Content', status: 'pending_approval', kind: 'single_job', clientId: 'c1', brandId: 'b1', accountManagerId: 'am-1',
        brief: { kind: 'single_job', request: { askedBy: 'Mais', source: 'email', words: 'October content' } },
      },
      isLoading: false,
      isSuccess: true,
    }
    state.savedBrief = { data: null, isSuccess: true }
    renderWizard('/campaigns/new-job?job=job-9')
    expect(await screen.findByTestId('sj-sent-note')).toHaveTextContent('waiting for Mais Abdulkarim')
    expect(await screen.findByTestId('sj-review')).toBeInTheDocument()
    expect(screen.queryByTestId('sj-back')).toBeNull()
    expect(screen.getByTestId('sj-approve')).toBeInTheDocument()
    expect(state.updateDraft).not.toHaveBeenCalled()
  })

  it('says a released job is released, with a way to it, rather than offering Approve again', async () => {
    state.job = {
      data: { id: 'job-9', name: 'Eid KV', status: 'approved', kind: 'single_job', clientId: 'c1', brandId: null, accountManagerId: null, brief: {} },
      isLoading: false,
      isSuccess: true,
    }
    state.savedBrief = { data: null, isSuccess: true }
    renderWizard('/campaigns/new-job?job=job-9')
    expect(await screen.findByTestId('sj-released')).toBeInTheDocument()
    expect(screen.getByTestId('sj-released-open')).toHaveAttribute('href', '/campaigns/job-9')
    expect(screen.queryByTestId('sj-approve')).toBeNull()
  })

  it('says so when the job cannot be found', async () => {
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    renderWizard('/campaigns/new-job?job=nope')
    expect(await screen.findByTestId('sj-not-found')).toBeInTheDocument()
  })
})

// ADR-0083 d.12 (12 Sep): a department with no lead names a TEAM LEAD as the owner at release,
// rather than the job going out ownerless. dep-prod has no department lead in the mock.
describe('SingleJobWizard — no department lead names a team lead (ADR-0083 d.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.job = { data: null, isLoading: false, isSuccess: true }
    state.savedBrief = { data: null, isSuccess: true }
    state.savedReceipt = { data: null }
    state.similar.mockResolvedValue([])
    state.teamLeads = [{ id: 'tl-1', name: 'Prod Team Lead', departmentId: 'dep-prod', teamId: 't1' }]
  })
  afterEach(() => { state.teamLeads = [] })

  function fillForProd() {
    type('sj-title', 'Trade stand graphics')
    type('sj-quantity', '1')
    type('sj-due', '2027-03-11')
    fireEvent.click(screen.getByTestId('sj-department-dep-prod'))
    pickLanguage()
  }

  it('offers the department team leads as owner, not the passive "no owner" notice', async () => {
    renderWizard()
    await toRequest()
    fillForProd()
    // Edward, 27 Sep: a drop-down, starting on "choose" when there is no department lead.
    expect(screen.getByTestId('sj-owner-select')).toHaveValue('')
    expect(screen.getByRole('option', { name: /Prod Team Lead/ })).toBeInTheDocument()
    expect(screen.queryByTestId('sj-owner-none')).toBeNull()
  })

  it('blocks release until a team lead is named', async () => {
    renderWizard()
    await toRequest()
    fillForProd()
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-review')
    fireEvent.click(screen.getByTestId('sj-approve'))
    // Sent back to who and when to name an owner; nothing is released.
    await screen.findByTestId('sj-request')
    expect(state.complete).not.toHaveBeenCalled()
  })

  it('releases with the named team lead as the deliverable owner', async () => {
    renderWizard()
    await toRequest()
    fillForProd()
    fireEvent.change(screen.getByTestId('sj-owner-select'), { target: { value: 'tl-1' } })
    fireEvent.click(screen.getByTestId('sj-next'))
    await screen.findByTestId('sj-review')
    fireEvent.click(screen.getByTestId('sj-approve'))
    await waitFor(() => expect(state.complete).toHaveBeenCalled())
    expect(state.complete).toHaveBeenCalledWith(expect.objectContaining({
      deliverables: [expect.objectContaining({ ownerUserId: 'tl-1' })],
    }))
  })
})
