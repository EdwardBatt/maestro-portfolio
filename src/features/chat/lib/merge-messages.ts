/**
 * Client-side message apply-path (ADR-0015 §5/§14): merge incoming messages (from the DB read, a
 * reconnect catch-up, or a realtime broadcast) into what's on screen — **dedupe by `id`, order by
 * `seq`**. A locally-sent message starts pending (no `seq`); when its server echo arrives (same
 * `id`, now with a `seq`) it replaces the pending copy and slots into order. Pending messages sort
 * after everything confirmed, so an optimistic send always shows at the bottom.
 */

export type MessageStatus = 'sent' | 'pending' | 'failed'

export interface ChatMessage {
  id: string
  seq: number | null // null while pending (optimistic, not yet acked)
  senderId: string
  senderName: string | null
  body: string
  createdAt: string
  status: MessageStatus
}

const sortKey = (m: ChatMessage): number => (m.seq == null ? Number.POSITIVE_INFINITY : m.seq)

/** A confirmed copy (has a seq) always wins over a pending one with the same id. */
function pick(prev: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  if (!prev) return next
  if (next.seq != null) return { ...prev, ...next } // server-confirmed wins, keep any known name
  if (prev.seq != null) return prev // ignore a pending dupe of an already-confirmed message
  return { ...prev, ...next }
}

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const m of existing) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, pick(byId.get(m.id), m))
  return [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.createdAt.localeCompare(b.createdAt))
}

/** True if a live broadcast arrived ahead of what we have — a gap that needs a catch-up refetch. */
export function hasSeqGap(existing: ChatMessage[], incomingSeq: number): boolean {
  const maxSeq = existing.reduce((m, x) => (x.seq != null && x.seq > m ? x.seq : m), 0)
  return incomingSeq > maxSeq + 1
}
