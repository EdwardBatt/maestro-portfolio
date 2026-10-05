import { useSyncExternalStore } from 'react'
import { supabaseUntyped } from '../supabase'
import { MAX_FILE_BYTES } from './kind'
import {
  MULTIPART_THRESHOLD,
  UploadAbortedError,
  clearResume,
  readResume,
  resumeKey,
  runParts,
  sweepExpiredResumes,
  writeResume,
  type CompletedPart,
  type ResumeRecord,
} from './multipart'
import { makeThumbnail, readDuration } from './thumbnail'

/**
 * Every upload in Maestro goes through here (ADR-0134 d.12–14, Figma K LB-05, I72).
 *
 * A module-level store — not React state — so an upload outlives the page that started it: the person
 * can leave the Library and the upload carries on, shown in the corner box (`app/UploadTray.tsx`) that
 * the shell mounts once. Components read it through `useSyncExternalStore`; no state library.
 *
 * Per file:
 * 1. Over 5 GB → refused in the box ("share a link instead").
 * 2. A file of the same name already in the folder → the box asks, each time: make it the next version
 *    (`library_add_version`), or keep both (saved as `name (2).ext`, the next free number).
 * 3. Up to 16 MB → one signed PUT. Bigger → 8 MB parts, three at a time, resumable for 24 hours
 *    (`multipart.ts`).
 * 4. The grid picture and a video's running time are made in the browser alongside (`thumbnail.ts`);
 *    neither can fail the upload.
 * 5. The row is written under RLS — the database decides who may.
 *
 * Bytes never pass through the app: `asset-url` only signs, the browser talks to storage (ADR-0022).
 */

export type UploadStatus = 'checking' | 'clash' | 'queued' | 'uploading' | 'saving' | 'done' | 'refused' | 'failed'
export type UploadError = 'tooBig' | 'notAllowed' | 'failed' | 'stopped'

export interface UploadItem {
  id: string
  file: File
  /** The name it is saved under — the file's own, or `name (2).ext` after "Keep both". */
  saveAs: string
  size: number
  folderId: string
  folderPath: string
  clientId: string
  isSource: boolean
  status: UploadStatus
  /** Bytes sent so far. */
  sent: number
  /** The file already in the folder under this name, while the box asks what to do. */
  clash: { assetId: string; currentVersion: number } | null
  /** Set once "Make it v{n}" is chosen. */
  asVersionOf: { assetId: string; version: number } | null
  /** Carrying on from parts sent earlier (picked again within 24 hours). */
  resumed: boolean
  error: UploadError | null
}

export interface UploadsSnapshot {
  items: UploadItem[]
  boxOpen: boolean
  /** The folder the box was last opened for, and the screen's "Change" handler. */
  target: { folderPath: string; onChangeFolder?: () => void } | null
}

export interface StartUploadsArgs {
  folderId: string
  folderPath: string
  clientId: string
  files: File[]
  isSource?: boolean
  onChangeFolder?: () => void
  /**
   * "Upload a new version" from a file's menu (ADR-0134 d.7): the one file picked becomes the next
   * version of this asset whatever its own name — no name question; the asset keeps its name.
   */
  versionOf?: { assetId: string; name: string; currentVersion: number }
}

/** How many files send at once (each big file also sends three parts at once). */
const FILES_IN_FLIGHT = 2

// ---- transport (replaceable in tests) ---------------------------------------------------------------

export class UploadHttpError extends Error {
  readonly status: number | null
  readonly code: string | null
  constructor(status: number | null, code: string | null) {
    super(code ?? `http_${status ?? 'error'}`)
    this.status = status
    this.code = code
  }
}

/** What one landed file records (ADR-0022: the row is written under RLS — the database decides who may). */
export interface NewAsset {
  tenantId: string | null
  folderId: string
  name: string
  provider: string
  objectKey: string
  contentType: string
  size: number
  uploadedBy: string | null
  thumbKey: string | null
  duration: number | null
  isSource: boolean
}

export interface UploadTransport {
  /** Call the `asset-url` function. */
  invoke: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>
  /** Write the asset row at v1; resolves with its id. */
  insertAsset: (a: NewAsset) => Promise<string>
  /** Write its first version row. */
  insertVersion: (assetId: string, a: NewAsset) => Promise<void>
  who: () => Promise<{ userId: string | null; tenantId: string | null }>
  /** PUT bytes; resolves with the ETag header when storage exposes it. */
  put: (url: string, body: Blob, contentType: string | null, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<string | null>
  thumbnail: (file: File) => Promise<Blob | null>
  duration: (file: File) => Promise<number | null>
}

async function httpErrorOf(err: unknown): Promise<UploadHttpError> {
  const ctx = (err as { context?: unknown } | null)?.context
  if (ctx instanceof Response) {
    let code: string | null = null
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; code?: unknown }
      code = typeof body.error === 'string' ? body.error : typeof body.code === 'string' ? body.code : null
    } catch {
      // not JSON
    }
    return new UploadHttpError(ctx.status, code)
  }
  return new UploadHttpError(null, err instanceof Error ? err.message : null)
}

function xhrPut(url: string, body: Blob, contentType: string | null, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new UploadAbortedError())
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    if (contentType) xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader('ETag')) : reject(new UploadHttpError(xhr.status, 'storage_refused')))
    xhr.onerror = () => reject(new UploadHttpError(null, 'network'))
    xhr.onabort = () => reject(new UploadAbortedError())
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

const defaultTransport: UploadTransport = {
  async invoke(body) {
    const res = await supabaseUntyped.functions.invoke('asset-url', { body })
    if (res.error) throw await httpErrorOf(res.error)
    return (res.data ?? {}) as Record<string, unknown>
  },
  async rpc(fn, args) {
    const { data, error } = await supabaseUntyped.rpc(fn, args)
    if (error) throw error
    return data
  },
  // The newer columns (I72) are sent only when they carry something, so a plain upload still writes on
  // a database that has not yet taken that migration.
  async insertAsset(a) {
    const assetRow: Record<string, unknown> = {
      tenant_id: a.tenantId,
      folder_id: a.folderId,
      name: a.name,
      provider: a.provider,
      object_key: a.objectKey,
      content_type: a.contentType,
      size_bytes: a.size,
      current_version: 1,
      uploaded_by: a.uploadedBy,
    }
    if (a.thumbKey) assetRow.thumb_object_key = a.thumbKey
    if (a.duration != null) assetRow.duration_seconds = a.duration
    if (a.isSource) assetRow.is_source = true
    const { data, error } = await supabaseUntyped.from('assets').insert(assetRow).select('id').single()
    if (error) throw error
    return (data as { id: string }).id
  },
  async insertVersion(assetId, a) {
    const versionRow: Record<string, unknown> = {
      tenant_id: a.tenantId,
      asset_id: assetId,
      version: 1,
      object_key: a.objectKey,
      content_type: a.contentType,
      size_bytes: a.size,
      uploaded_by: a.uploadedBy,
    }
    if (a.thumbKey) versionRow.thumb_object_key = a.thumbKey
    if (a.duration != null) versionRow.duration_seconds = a.duration
    const { error } = await supabaseUntyped.from('asset_versions').insert(versionRow)
    if (error) throw error
  },
  async who() {
    const { data } = await supabaseUntyped.auth.getSession()
    const user = data.session?.user
    const meta = (user?.app_metadata ?? {}) as Record<string, unknown>
    return { userId: user?.id ?? null, tenantId: typeof meta.tenant_id === 'string' ? meta.tenant_id : null }
  },
  put: xhrPut,
  thumbnail: makeThumbnail,
  duration: readDuration,
}

let transport: UploadTransport = defaultTransport

/** Tests only: swap parts of the transport; `null` restores the real one. */
export function __setUploadTransport(t: Partial<UploadTransport> | null): void {
  transport = t ? { ...defaultTransport, ...t } : defaultTransport
}

// ---- the store ----------------------------------------------------------------------------------------

let snapshot: UploadsSnapshot = { items: [], boxOpen: false, target: null }
const listeners = new Set<() => void>()
const finishedListeners = new Set<(item: UploadItem) => void>()
const controllers = new Map<string, AbortController>()
let seq = 0
let swept = false

function emit(next: Partial<UploadsSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  syncUnloadGuard()
  for (const l of listeners) l()
}

function patch(id: string, change: Partial<UploadItem>): void {
  if (!snapshot.items.some((i) => i.id === id)) return
  emit({ items: snapshot.items.map((i) => (i.id === id ? { ...i, ...change } : i)) })
}

function find(id: string): UploadItem | undefined {
  return snapshot.items.find((i) => i.id === id)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getUploadsSnapshot(): UploadsSnapshot {
  return snapshot
}

export function useUploads(): UploadsSnapshot {
  return useSyncExternalStore(subscribe, getUploadsSnapshot, getUploadsSnapshot)
}

/** Told once per file that lands — the shell refreshes the Library's reads with it. */
export function onUploadFinished(l: (item: UploadItem) => void): () => void {
  finishedListeners.add(l)
  return () => finishedListeners.delete(l)
}

export function isActive(i: UploadItem): boolean {
  return i.status === 'checking' || i.status === 'queued' || i.status === 'uploading' || i.status === 'saving'
}

export function openUploadBox(): void {
  emit({ boxOpen: true })
}

export function closeUploadBox(): void {
  // What is finished leaves with the box; what is running, waiting for an answer or stopped stays
  // in the corner.
  emit({ boxOpen: false, items: snapshot.items.filter((i) => i.status !== 'done' && i.status !== 'refused') })
}

// Closing the tab stops uploads (d.14) — so the browser asks first, but only while one is running.
let guardOn = false
function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  e.returnValue = ''
}
function syncUnloadGuard(): void {
  if (typeof window === 'undefined') return
  const want = snapshot.items.some(isActive)
  if (want === guardOn) return
  guardOn = want
  if (want) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

// ---- naming -------------------------------------------------------------------------------------------

/** `logo.svg` → `logo (2).svg`; a name already ending ` (k)` is renumbered rather than stacked. */
export function keepBothName(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0 && dot < name.length - 1
  const base = (hasExt ? name.slice(0, dot) : name).replace(/ \(\d+\)$/, '')
  return `${base} (${n})${hasExt ? name.slice(dot) : ''}`
}

/** The first `name (n).ext`, from 2, that `taken` says is free. */
export async function nextFreeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  const m = / \((\d+)\)(\.[^.]+)?$/.exec(name)
  let n = m ? Math.max(2, Number(m[1]) + 1) : 2
  for (; n < 1000; n++) {
    const candidate = keepBothName(name, n)
    if (!(await taken(candidate))) return candidate
  }
  return keepBothName(name, Date.now())
}

async function findByName(folderId: string, name: string): Promise<{ assetId: string; currentVersion: number } | null> {
  const data = await transport.rpc('library_find_by_name', { p_folder: folderId, p_name: name })
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string; current_version?: number } | null | undefined
  return row?.id ? { assetId: row.id, currentVersion: Number(row.current_version ?? 1) } : null
}

// ---- starting ---------------------------------------------------------------------------------------

/** Open the LB-05 box for these files and start them. */
export function startUploads(args: StartUploadsArgs): void {
  if (!swept) {
    swept = true
    sweepExpiredResumes()
  }
  const { versionOf } = args
  const files = versionOf ? args.files.slice(0, 1) : args.files
  const fresh: UploadItem[] = files.map((file) => {
    const tooBig = file.size > MAX_FILE_BYTES
    return {
      id: `u${++seq}`,
      file,
      saveAs: versionOf ? versionOf.name : file.name,
      size: file.size,
      folderId: args.folderId,
      folderPath: args.folderPath,
      clientId: args.clientId,
      isSource: !!args.isSource,
      status: tooBig ? 'refused' : versionOf ? 'queued' : 'checking',
      sent: 0,
      clash: null,
      asVersionOf: versionOf ? { assetId: versionOf.assetId, version: versionOf.currentVersion + 1 } : null,
      resumed: false,
      error: tooBig ? 'tooBig' : null,
    }
  })
  emit({
    // A new batch clears what already finished from the last one.
    items: [...snapshot.items.filter((i) => i.status !== 'done' && i.status !== 'refused'), ...fresh],
    boxOpen: true,
    target: { folderPath: args.folderPath, onChangeFolder: args.onChangeFolder },
  })
  for (const item of fresh) if (item.status === 'checking') void check(item.id)
  pump()
}

async function check(id: string): Promise<void> {
  const item = find(id)
  if (!item) return
  let clash: { assetId: string; currentVersion: number } | null = null
  try {
    clash = await findByName(item.folderId, item.file.name)
  } catch {
    // The question cannot be asked (the lookup failed): the file goes in as a new one, never blocked.
    clash = null
  }
  if (!find(id)) return
  patch(id, clash ? { status: 'clash', clash } : { status: 'queued' })
  pump()
}

/** Files that have not started sending — the ones "Change" can still move. */
export function movableUploads(items: UploadItem[] = snapshot.items): UploadItem[] {
  return items.filter((i) => !i.asVersionOf && i.sent === 0 && (i.status === 'checking' || i.status === 'clash' || i.status === 'queued' || i.status === 'failed'))
}

/**
 * "Change" in the box (Figma LB-05): every file not yet sending goes to another folder of the same
 * client, its name back to its own and its clash asked afresh there. A file already sending, done or
 * refused stays where it is — its bytes are on their way to the first folder.
 */
export function changeFolder(folderId: string, folderPath: string): void {
  const moving = new Set(movableUploads().map((i) => i.id))
  if (moving.size === 0) return
  for (const id of moving) {
    controllers.get(id)?.abort()
    controllers.delete(id)
  }
  emit({
    items: snapshot.items.map((i) => (moving.has(i.id)
      ? { ...i, folderId, folderPath, saveAs: i.file.name, clash: null, error: null, status: 'checking' as const }
      : i)),
    target: snapshot.target ? { ...snapshot.target, folderPath } : { folderPath },
  })
  for (const id of moving) void check(id)
}

/** The person's answer to a name clash: the next version of that file, or keep both. */
export async function resolveClash(id: string, choice: 'version' | 'keep'): Promise<void> {
  const item = find(id)
  if (!item || item.status !== 'clash' || !item.clash) return
  if (choice === 'version') {
    patch(id, { status: 'queued', asVersionOf: { assetId: item.clash.assetId, version: item.clash.currentVersion + 1 }, clash: null })
  } else {
    patch(id, { status: 'checking' })
    let saveAs = keepBothName(item.file.name, 2)
    try {
      saveAs = await nextFreeName(item.file.name, async (c) => (await findByName(item.folderId, c)) !== null)
    } catch {
      // keep the first candidate
    }
    if (!find(id)) return
    patch(id, { status: 'queued', saveAs, clash: null })
  }
  pump()
}

/** Remove one file from the box — a refused one, a stopped one, or one still waiting. */
export function removeUpload(id: string): void {
  const item = find(id)
  if (!item) return
  controllers.get(id)?.abort()
  controllers.delete(id)
  emit({ items: snapshot.items.filter((i) => i.id !== id) })
  if (item.size > MULTIPART_THRESHOLD && item.status !== 'done') forgetPartial(item)
}

/** "Cancel the rest": every file not yet finished stops and leaves the box. */
export function cancelRemaining(): void {
  const leaving = snapshot.items.filter((i) => i.status !== 'done' && i.status !== 'refused')
  for (const i of leaving) {
    controllers.get(i.id)?.abort()
    controllers.delete(i.id)
  }
  emit({ items: snapshot.items.filter((i) => i.status === 'done' || i.status === 'refused') })
  for (const i of leaving) if (i.size > MULTIPART_THRESHOLD) forgetPartial(i)
}

/** Try a stopped file again — a big one carries on from the parts already sent. */
export function retryUpload(id: string): void {
  const item = find(id)
  if (!item || item.status !== 'failed') return
  patch(id, { status: 'queued', error: null })
  pump()
}

/** A cancelled big file: drop its record and ask storage to drop its parts (best-effort). */
function forgetPartial(item: UploadItem): void {
  const key = resumeKey(item.folderId, item.file)
  const rec = readResume(key)
  clearResume(key)
  if (rec) void transport.invoke({ op: 'multipart_abort', objectKey: rec.objectKey, uploadId: rec.uploadId }).catch(() => undefined)
}

function pump(): void {
  const running = snapshot.items.filter((i) => i.status === 'uploading' || i.status === 'saving').length
  let room = FILES_IN_FLIGHT - running
  for (const item of snapshot.items) {
    if (room <= 0) break
    if (item.status !== 'queued') continue
    room--
    patch(item.id, { status: 'uploading', sent: 0 })
    void run(item.id)
  }
}

// ---- sending -------------------------------------------------------------------------------------------

async function run(id: string): Promise<void> {
  const item = find(id)
  if (!item) return
  const controller = new AbortController()
  controllers.set(id, controller)
  const { file } = item
  const contentType = file.type || 'application/octet-stream'
  // The picture and the running time are made while the bytes travel; neither can fail the upload.
  const extras = Promise.all([
    transport.thumbnail(file).catch(() => null),
    transport.duration(file).catch(() => null),
  ])

  try {
    const sent = file.size > MULTIPART_THRESHOLD
      ? await sendInParts(id, item, contentType, controller.signal)
      : await sendWhole(id, item, contentType, controller.signal)

    if (!find(id)) return
    patch(id, { status: 'saving', sent: file.size })
    const [thumb, duration] = await extras
    const thumbKey = thumb ? await sendThumb(sent.objectKey, thumb) : null
    await record(find(id) ?? item, sent, contentType, thumbKey, duration)
    const done = find(id)
    if (!done) return
    patch(id, { status: 'done' })
    const final = find(id)
    if (final) for (const l of finishedListeners) l(final)
  } catch (err) {
    if (err instanceof UploadAbortedError || controller.signal.aborted) return
    if (!find(id)) return
    if (err instanceof UploadHttpError && (err.status === 413 || err.code === 'too_big')) {
      patch(id, { status: 'refused', error: 'tooBig' })
    } else if (err instanceof UploadHttpError && err.status === 403) {
      patch(id, { status: 'failed', error: 'notAllowed' })
    } else {
      patch(id, { status: 'failed', error: file.size > MULTIPART_THRESHOLD ? 'stopped' : 'failed' })
    }
  } finally {
    controllers.delete(id)
    pump()
  }
}

interface Sent {
  objectKey: string
  provider: string
}

async function sendWhole(id: string, item: UploadItem, contentType: string, signal: AbortSignal): Promise<Sent> {
  const signed = await transport.invoke({ op: 'upload', folderId: item.folderId, fileName: item.saveAs, contentType, size: item.size })
  const uploadUrl = String(signed.uploadUrl ?? '')
  const objectKey = String(signed.objectKey ?? '')
  if (!uploadUrl || !objectKey) throw new UploadHttpError(null, 'sign_failed')
  await transport.put(uploadUrl, item.file, contentType, (loaded) => patch(id, { sent: loaded }), signal)
  return { objectKey, provider: String(signed.provider ?? 'b2') }
}

async function sendInParts(id: string, item: UploadItem, contentType: string, signal: AbortSignal, fresh = false): Promise<Sent> {
  const key = resumeKey(item.folderId, item.file)
  let rec: ResumeRecord | null = fresh ? null : readResume(key)
  const resumed = !!rec && rec.parts.length > 0
  if (!rec) {
    const created = await transport.invoke({ op: 'multipart_create', folderId: item.folderId, fileName: item.saveAs, contentType, size: item.size })
    rec = { uploadId: String(created.uploadId ?? ''), objectKey: String(created.objectKey ?? ''), parts: [], startedAt: Date.now() }
    if (!rec.uploadId || !rec.objectKey) throw new UploadHttpError(null, 'sign_failed')
    writeResume(key, rec)
  }
  patch(id, { resumed })
  const current = rec
  let landedThisRun = 0
  let parts: CompletedPart[]
  try {
    parts = await runParts({
      file: item.file,
      completed: current.parts,
      signal,
      transport: {
        sign: async (partNumbers) => {
          const res = await transport.invoke({ op: 'multipart_sign', objectKey: current.objectKey, uploadId: current.uploadId, partNumbers })
          const urls = Array.isArray(res.urls) ? (res.urls as { partNumber: number; url: string }[]) : []
          return new Map(urls.map((u) => [u.partNumber, u.url]))
        },
        put: async (url, body, onProgress, s) => {
          const etag = await transport.put(url, body, null, onProgress, s)
          // Without the ETag the parts cannot be joined — storage must expose it to the browser (CORS).
          if (!etag) throw new UploadHttpError(null, 'etag_unreadable')
          return etag
        },
      },
      onPartDone: (part) => {
        landedThisRun++
        current.parts = [...current.parts.filter((p) => p.partNumber !== part.partNumber), part]
        writeResume(key, current)
      },
      onProgress: (bytes) => patch(id, { sent: bytes }),
    })
  } catch (err) {
    // A remembered upload storage no longer knows (swept, or aborted elsewhere): start it afresh once.
    if (resumed && landedThisRun === 0 && !signal.aborted && !(err instanceof UploadAbortedError)) {
      clearResume(key)
      return sendInParts(id, item, contentType, signal, true)
    }
    throw err
  }
  await transport.invoke({ op: 'multipart_complete', objectKey: current.objectKey, uploadId: current.uploadId, parts })
  clearResume(key)
  return { objectKey: current.objectKey, provider: 'b2' }
}

async function sendThumb(objectKey: string, thumb: Blob): Promise<string | null> {
  try {
    const signed = await transport.invoke({ op: 'thumb_upload', objectKey })
    const url = String(signed.uploadUrl ?? '')
    if (!url) return null
    await transport.put(url, thumb, thumb.type || 'image/webp', () => undefined, new AbortController().signal)
    const key = signed.thumbObjectKey ?? signed.objectKey
    return typeof key === 'string' && key ? key : `${objectKey}.thumb.webp`
  } catch {
    return null
  }
}

async function record(item: UploadItem, sent: Sent, contentType: string, thumbKey: string | null, duration: number | null): Promise<void> {
  if (item.asVersionOf) {
    await transport.rpc('library_add_version', {
      p_asset: item.asVersionOf.assetId,
      p_object_key: sent.objectKey,
      p_content_type: contentType,
      p_size: item.size,
      p_thumb_object_key: thumbKey,
      p_duration: duration,
    })
    return
  }
  const { userId, tenantId } = await transport.who()
  const row: NewAsset = {
    tenantId,
    folderId: item.folderId,
    name: item.saveAs,
    provider: sent.provider,
    objectKey: sent.objectKey,
    contentType,
    size: item.size,
    uploadedBy: userId,
    thumbKey,
    duration,
    isSource: item.isSource,
  }
  const assetId = await transport.insertAsset(row)
  await transport.insertVersion(assetId, row)
}

/** Tests only: empty the store. */
export function __resetUploads(): void {
  for (const c of controllers.values()) c.abort()
  controllers.clear()
  snapshot = { items: [], boxOpen: false, target: null }
  syncUnloadGuard()
  for (const l of listeners) l()
}
