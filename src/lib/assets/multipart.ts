/**
 * Big files go in parts, and a stopped upload carries on (ADR-0134 d.13, I72).
 *
 * A file over `MULTIPART_THRESHOLD` is sent as 8 MB parts, three at a time, each part retried with a
 * growing wait when the line drops. The parts already sent are remembered in this browser for 24 hours
 * (`localStorage`, keyed by folder + name + size + last-modified): picking the same file again within
 * that time carries on from the first part not yet sent. After 24 hours the record is thrown away; the
 * server's sweep aborts the parts it left in storage.
 *
 * Nothing here talks to the network directly — `runParts` is handed `sign` and `put`, so the engine
 * (`uploads.ts`) owns the transport and the tests drive this with fakes.
 */

export const MULTIPART_THRESHOLD = 16 * 1024 ** 2
export const PART_SIZE = 8 * 1024 ** 2
export const PARTS_IN_FLIGHT = 3
export const RESUME_TTL_MS = 24 * 60 * 60 * 1000
/** Waits before each retry of one part: 1 s, 2 s, 4 s, 8 s — then the upload stops (and can resume). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

const PREFIX = 'maestro.upload.'

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface ResumeRecord {
  uploadId: string
  objectKey: string
  parts: CompletedPart[]
  startedAt: number
}

export interface FileIdentity {
  name: string
  size: number
  lastModified: number
}

export function resumeKey(folderId: string, file: FileIdentity): string {
  return `${PREFIX}${folderId}|${file.name}|${file.size}|${file.lastModified}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function parse(raw: string | null): ResumeRecord | null {
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as Partial<ResumeRecord>
    if (typeof r.uploadId !== 'string' || typeof r.objectKey !== 'string' || typeof r.startedAt !== 'number' || !Array.isArray(r.parts)) return null
    const parts = r.parts.filter((p): p is CompletedPart => !!p && typeof p.partNumber === 'number' && typeof p.etag === 'string')
    return { uploadId: r.uploadId, objectKey: r.objectKey, startedAt: r.startedAt, parts }
  } catch {
    return null
  }
}

/** The half-finished upload for this key, or null. One older than 24 hours is discarded here. */
export function readResume(key: string, now = Date.now()): ResumeRecord | null {
  const s = storage()
  if (!s) return null
  let rec: ResumeRecord | null = null
  try {
    rec = parse(s.getItem(key))
  } catch {
    return null
  }
  if (!rec) return null
  if (now - rec.startedAt >= RESUME_TTL_MS) {
    clearResume(key)
    return null
  }
  return rec
}

export function writeResume(key: string, rec: ResumeRecord): void {
  try {
    storage()?.setItem(key, JSON.stringify(rec))
  } catch {
    // Storage full or blocked: the upload still runs, it just cannot carry on after a reload.
  }
}

export function clearResume(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // nothing to clear
  }
}

/** Drop every remembered upload older than 24 hours (run once when the engine wakes). */
export function sweepExpiredResumes(now = Date.now()): void {
  const s = storage()
  if (!s) return
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const rec = parse(s.getItem(k))
      if (!rec || now - rec.startedAt >= RESUME_TTL_MS) s.removeItem(k)
    }
  } catch {
    // storage unavailable
  }
}

export function partCount(size: number): number {
  return Math.max(1, Math.ceil(size / PART_SIZE))
}

/** Byte range `[start, end)` of a 1-based part. */
export function partRange(partNumber: number, size: number): [number, number] {
  const start = (partNumber - 1) * PART_SIZE
  return [start, Math.min(size, start + PART_SIZE)]
}

/** Part numbers still to send, ascending. */
export function pendingParts(total: number, completed: CompletedPart[]): number[] {
  const done = new Set(completed.map((p) => p.partNumber))
  const out: number[] = []
  for (let n = 1; n <= total; n++) if (!done.has(n)) out.push(n)
  return out
}

export interface PartTransport {
  /** Presigned PUT addresses for these part numbers. */
  sign: (partNumbers: number[]) => Promise<Map<number, string>>
  /** PUT one part; resolves with the ETag storage returned. `onProgress` gets bytes sent of this part. */
  put: (url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}

export interface RunPartsArgs {
  file: Blob & { size: number }
  completed: CompletedPart[]
  transport: PartTransport
  signal: AbortSignal
  /** Called after each part lands — persist the record here. */
  onPartDone: (part: CompletedPart) => void
  /** Total bytes confirmed or in flight, for the progress bar. */
  onProgress: (sentBytes: number) => void
  inFlight?: number
}

export class UploadAbortedError extends Error {
  constructor() {
    super('upload_cancelled')
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Send every part not yet in `completed`, `inFlight` at a time. Resolves with every part (old and new)
 * in part order. A part that still fails after the retries rejects the whole run — the record keeps
 * what landed, so picking the file again carries on.
 */
export async function runParts(args: RunPartsArgs): Promise<CompletedPart[]> {
  const { file, transport, signal, onPartDone, onProgress } = args
  const sleep = transport.sleep ?? defaultSleep
  const total = partCount(file.size)
  const done: CompletedPart[] = [...args.completed]
  const queue = pendingParts(total, done)
  const inFlightBytes = new Map<number, number>()
  const confirmedBytes = () => done.reduce((sum, p) => { const [a, b] = partRange(p.partNumber, file.size); return sum + (b - a) }, 0)
  const report = () => onProgress(confirmedBytes() + [...inFlightBytes.values()].reduce((a, b) => a + b, 0))
  report()

  async function sendOne(partNumber: number): Promise<void> {
    const [start, end] = partRange(partNumber, file.size)
    const body = file.slice(start, end)
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new UploadAbortedError()
      try {
        const urls = await transport.sign([partNumber])
        const url = urls.get(partNumber)
        if (!url) throw new Error('sign_failed')
        const etag = await transport.put(url, body, (loaded) => { inFlightBytes.set(partNumber, loaded); report() }, signal)
        inFlightBytes.delete(partNumber)
        const part = { partNumber, etag }
        done.push(part)
        onPartDone(part)
        report()
        return
      } catch (err) {
        inFlightBytes.delete(partNumber)
        report()
        if (signal.aborted || err instanceof UploadAbortedError) throw new UploadAbortedError()
        const wait = RETRY_DELAYS_MS[attempt]
        if (wait === undefined) throw err
        await sleep(wait)
      }
    }
  }

  // One part failing for good stops the others picking up new parts (those in flight finish and are kept).
  let stopped = false
  async function worker(): Promise<void> {
    for (;;) {
      if (stopped) return
      const next = queue.shift()
      if (next === undefined) return
      try {
        await sendOne(next)
      } catch (err) {
        stopped = true
        throw err
      }
    }
  }

  const n = Math.min(args.inFlight ?? PARTS_IN_FLIGHT, Math.max(1, queue.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return done.sort((a, b) => a.partNumber - b.partNumber)
}
