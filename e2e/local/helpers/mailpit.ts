import { expect } from '@playwright/test'

/**
 * Mailpit — the local mailbox every outbound email lands in when `EMAIL_TRANSPORT=mailpit`
 * (supabase/functions/_shared/email-transport.ts). Auth mail (invites, password resets) arrives
 * here through GoTrue's SMTP regardless; notification and error-report mail arrives here only with
 * that setting. Read at http://127.0.0.1:54324; API at /api/v1.
 *
 * Every helper takes the RECIPIENT ADDRESS, never a name: the address is the fact the system
 * chose, and plus-tags (`maestro.dev+tl@example.test`) are exactly what Mailpit indexes.
 */
const BASE = process.env.MAILPIT_URL_HOST ?? 'http://127.0.0.1:54324'

export interface MailSummary {
  ID: string
  Subject: string
  To: { Address: string; Name: string }[]
  From: { Address: string; Name: string }
  Created: string
  Snippet: string
}

export async function clearMailbox(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/messages`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`mailpit: could not clear (${res.status})`)
}

export async function searchMail(query: string): Promise<MailSummary[]> {
  const res = await fetch(`${BASE}/api/v1/search?query=${encodeURIComponent(query)}&limit=50`)
  if (!res.ok) throw new Error(`mailpit: search failed (${res.status})`)
  const body = (await res.json()) as { messages: MailSummary[] }
  return body.messages ?? []
}

/** The HTML body of one message — for asserting the deep link and the wording. */
export async function readMailHtml(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/message/${id}`)
  if (!res.ok) throw new Error(`mailpit: read failed (${res.status})`)
  const body = (await res.json()) as { HTML: string; Text: string }
  return body.HTML || body.Text
}

/**
 * Wait for a mail TO `address` whose subject contains `subject`. The slow lane is pg_net → Edge
 * runtime → Mailpit, typically a second or two locally; the poll gives it ten.
 */
export async function expectMail(
  address: string,
  subject: string | RegExp,
  opts: { timeoutMs?: number } = {},
): Promise<MailSummary> {
  const timeout = opts.timeoutMs ?? 10_000
  const started = Date.now()
  let last: MailSummary[] = []
  while (Date.now() - started < timeout) {
    last = await searchMail(`to:${address}`)
    const hit = last.find((m) =>
      typeof subject === 'string' ? m.Subject.includes(subject) : subject.test(m.Subject),
    )
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 500))
  }
  expect(
    last.map((m) => m.Subject),
    `no mail to ${address} matching ${String(subject)} within ${timeout}ms`,
  ).toContainEqual(expect.stringMatching(typeof subject === 'string' ? subject : subject))
  throw new Error('unreachable')
}

/** Assert NO mail reached `address` — the actor is never emailed about their own action. */
export async function expectNoMail(address: string, settleMs = 2_000): Promise<void> {
  await new Promise((r) => setTimeout(r, settleMs))
  const hits = await searchMail(`to:${address}`)
  expect(hits, `expected no mail to ${address}, got: ${hits.map((m) => m.Subject).join(' | ')}`).toHaveLength(0)
}
