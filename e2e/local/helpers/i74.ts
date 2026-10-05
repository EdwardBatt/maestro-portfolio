import { expect, type Browser, type Page } from '@playwright/test'
import { authFile, PEOPLE, type PersonTag } from '../fixtures'
import { rows, userIdOf } from './db'
import { releaseSingleJob, type ReleasedJob } from './single-job'
import { approveTaskList } from './piece'

/**
 * Shared ground for the I74 coverage specs (the Schedule rework — ADR-0139/0140/0141/0142).
 *
 * People are the seed's (names in `PEOPLE`); in the demo data they read as Inas Azmi (`am`), Fadia Wael
 * (`lead`, the Creative department lead), Noor Kanaan (`tl`, Design team lead), Ismail Naji (`deputy`, Design),
 * Zubaida Jamil (`maker`, Design), Basheer Ali (`motiontl`), Lujain Rashed (`animator`, Motion), Osama Bakri
 * (`content`), Abeer Saad (`copytl`), Zuhour Talal (`writer`). The suite runs on the BARE seed (traps: "Browser
 * specs fail on names after the demo scripts ran"), so assertions use `PEOPLE.<tag>.name`.
 *
 * Fixtures are made through the product's doors (the single-job flow, the RPCs a screen's button calls, signed
 * in as the person pressing it); the service role is used for assertions only.
 */
export const API = 'http://127.0.0.1:54321'
export const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export type Tag = PersonTag
export { PEOPLE }

/** A fresh page signed in as a seeded person. Close it with `page.context().close()`. */
export async function as(browser: Browser, tag: Tag): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) })
  return ctx.newPage()
}

const tokens = new Map<Tag, { token: string; at: number }>()
/** A fresh access token for a person (cached ten minutes). */
export async function tokenOf(tag: Tag): Promise<string> {
  const hit = tokens.get(tag)
  if (hit && Date.now() - hit.at < 600_000) return hit.token
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEOPLE[tag].email, password: 'devpassword' }),
  })
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`could not sign ${tag} in: ${JSON.stringify(body)}`)
  tokens.set(tag, { token: body.access_token, at: Date.now() })
  return body.access_token
}

/** Call an RPC as a person; returns the status and body WITHOUT judging them (for refusals). */
export async function rpcRaw(tag: Tag, fn: string, args: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${await tokenOf(tag)}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, text: await res.text() }
}

/** Call an RPC as a person — the door a screen's button uses. Refused = the test stops, with the reason. */
export async function rpcAs<T = unknown>(tag: Tag, fn: string, args: Record<string, unknown>): Promise<T> {
  const { status, text } = await rpcRaw(tag, fn, args)
  expect(status, `${fn} as ${tag}: ${text}`).toBeLessThan(300)
  return (text ? JSON.parse(text) : null) as T
}

/** A REST write as a person (RLS applies). */
export async function restAs(tag: Tag, method: 'POST' | 'PATCH' | 'DELETE', table: string, query: string, body?: unknown) {
  const res = await fetch(`${API}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${await tokenOf(tag)}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

export const idOf = (tag: Tag) => userIdOf(PEOPLE[tag].email)

/** The person's bookable resource id. */
export async function resourceIdOf(tag: Tag): Promise<string> {
  const uid = await idOf(tag)
  const [r] = await rows<{ id: string }>('resources', `select=id&user_id=eq.${uid}&is_active=eq.true`)
  expect(r, `${tag} is a bookable resource`).toBeTruthy()
  return r!.id
}

export interface TaskRow {
  id: string
  title: string
  status: string
  assignee_id: string | null
  starts_at: string | null
  due_at: string | null
  sla_hours: number | null
  deliverable_id: string
}
export async function taskRow(id: string): Promise<TaskRow> {
  const [t] = await rows<TaskRow>('sub_tasks', `select=id,title,status,assignee_id,starts_at,due_at,sla_hours,deliverable_id&id=eq.${id}`)
  expect(t, `task ${id} exists`).toBeTruthy()
  return t!
}
export async function tasksOf(deliverableId: string): Promise<TaskRow[]> {
  return rows<TaskRow>(
    'sub_tasks',
    `select=id,title,status,assignee_id,starts_at,due_at,sla_hours,deliverable_id&deliverable_id=eq.${deliverableId}&status=neq.cancelled&order=sort_order.asc,unit_index.asc`,
  )
}

/** Confirmed bookings on a task. */
export async function bookingsOf(subTaskId: string) {
  return rows<{ id: string; resource_id: string; starts_at: string; ends_at: string; state: string }>(
    'bookings',
    `select=id,resource_id,starts_at,ends_at,state&sub_task_id=eq.${subTaskId}&state=neq.cancelled`,
  )
}

/** Assignment requests (ADR-0087/0139) on a task, newest first. */
export async function requestsOn(subTaskId: string) {
  return rows<Record<string, unknown> & { id: string; status: string; requested_by: string | null }>(
    'sub_task_assignment_requests',
    `select=*&sub_task_id=eq.${subTaskId}&order=created_at.desc`,
  )
}

/** Notifications of a type about one entity, to whom. */
export async function toldAbout(type: string, entityId: string): Promise<string[]> {
  const n = await rows<{ user_id: string }>('notifications', `select=user_id&type=eq.${type}&entity_id=eq.${entityId}`)
  return n.map((x) => x.user_id)
}

/** A Baghdad calendar day `offset` days from today. */
export function day(offset: number): string {
  return new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)
}
/** The first Sunday–Thursday (Baghdad's working week) on or after `offset` days out. */
export function workday(offset: number): string {
  let n = offset
  for (;;) {
    const d = day(n)
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay() // 0 Sun … 6 Sat
    if (wd !== 5 && wd !== 6) return d
    n++
  }
}
/** A moment on a Baghdad day, as UTC ISO (09:00 Baghdad = 06:00Z). */
export const at = (isoDay: string, hourBaghdad = 9) => `${isoDay}T${String(hourBaghdad - 3).padStart(2, '0')}:00:00Z`

/**
 * A released Creative single job with its type's task list, approved by its owner (the Creative department lead,
 * Fadia in the demo data) so its tasks are ready to be booked. Made by the account manager through the single-job
 * flow, the list approved on the piece panel.
 */
export async function makeApprovedPiece(browser: Browser, title: string, opts: { due?: string; approve?: boolean } = {}): Promise<{ job: ReleasedJob; tasks: TaskRow[] }> {
  const am = await as(browser, 'am')
  const job = await releaseSingleJob(am, { title, department: 'Creative', type: 'Social Advertisement', due: opts.due })
  await am.context().close()
  if (opts.approve !== false) {
    const lead = await as(browser, 'lead')
    await approveTaskList(lead, job)
    await lead.context().close()
  }
  const tasks = await tasksOf(job.deliverableId)
  expect(tasks.length, `${title} has its type's task list`).toBeGreaterThan(1)
  return { job, tasks }
}

/** Give a task to a person through `update_task_assignment`, as the person who may (the door the editors call). */
export async function assignAs(
  tag: Tag,
  subTaskId: string,
  assignee: Tag,
  reviewer: Tag,
  onDay: string,
  hours = 2,
): Promise<{ outcome: string; request_id: string | null }> {
  const t = await taskRow(subTaskId)
  const out = await rpcAs<{ outcome: string; request_id: string | null }[]>(tag, 'update_task_assignment', {
    p_sub_task: subTaskId,
    p_title: t.title,
    p_assignee: await idOf(assignee),
    p_reviewers: [{ user_id: await idOf(reviewer), is_mandatory: true }],
    p_starts_at: at(onDay, 9),
    p_due_at: at(onDay, 17),
    p_hours: hours,
    p_review_mode: 'manual',
  })
  return out[0]!
}

/** A success notice on the Schedule (the undo toast) — present, and not a refusal. */
export async function expectToast(page: Page, re: RegExp) {
  const toast = page.getByTestId('schedule-toast')
  await expect(toast).toBeVisible({ timeout: 15_000 })
  await expect(toast).toContainText(re)
}

/**
 * Block time's Who and dates are the Schedule's pickers (I74.27, SC-22): pick the person, then the days — a day
 * clicked twice is that day alone, a later day after it makes the span.
 */
export async function blockTimeFill(page: Page, resourceId: string, from: string, to: string = from) {
  await page.getByTestId('block-time-who').click()
  await page.getByTestId(`block-time-people-${resourceId}`).click()
  await page.getByTestId('block-time-dates').click()
  const day = (iso: string) => page.getByTestId(`block-time-dates-picker-day-${iso}`)
  // Three weeks show at a time: page forward (or back) to the first day.
  const opened = await page.getByTestId('block-time-dates-picker').locator('[data-testid^="block-time-dates-picker-day-"]').first().getAttribute('data-testid')
  const step = from < (opened ?? '').slice(-10) ? 'prev' : 'next'
  for (let i = 0; i < 40 && (await day(from).count()) === 0; i++) await page.getByTestId(`block-time-dates-picker-${step}`).click()
  await day(from).click()
  await day(from).click()
  if (to !== from) {
    for (let i = 0; i < 40 && (await day(to).count()) === 0; i++) await page.getByTestId('block-time-dates-picker-next').click()
    await day(to).click()
  }
  await page.getByTestId('block-time-dates-picker-done').click()
  await expect(page.getByTestId('block-time-dates-pop')).toHaveCount(0)
}

/** Whom Block time's Who offers — each row's full name. */
export async function blockTimeOffers(page: Page): Promise<string[]> {
  await page.getByTestId('block-time-who').click()
  const names = await page.getByTestId('block-time-people').locator('.sc-person-name').allTextContents()
  await page.getByTestId('block-time-who').click()
  return names.map((x) => x.trim()).filter(Boolean)
}
