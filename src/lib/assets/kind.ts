/**
 * What a file IS, in words (ADR-0134 d.4): "Word document", "PNG image", "Video · 0:06" — never the raw
 * type a browser reports ("application/vnd.openxmlformats-officedocument…", LB-NOTES item 02).
 *
 * Read from the name's extension first, because that is what the person sees and chose; the content type
 * only breaks a tie for a name with no extension. One table, shared by every surface that lists a file —
 * the Library, search, the upload box, a piece's folder — so the same file never reads two ways.
 *
 * `tone` picks the badge's ground (the `--kind-*` tokens): a picture, a design source, a video or
 * document, a PDF, or neutral. `bucket` is the search filter it falls under (LB-08).
 */

export type KindTone = 'image' | 'source' | 'media' | 'pdf' | 'neutral' | 'link'
export type KindBucket = 'image' | 'document' | 'video' | 'link' | 'proof' | 'other'

export interface FileKind {
  /** The short label on the badge: "SVG", "DOCX", "MP4", "LINK". */
  badge: string
  /** An i18n key under `library.kind.*`; `ext` is passed for the generic "{{ext}} file". */
  wordsKey: string
  tone: KindTone
  bucket: KindBucket
  /** The browser can show it inline (ADR-0134 d.6). */
  previewable: 'image' | 'pdf' | 'video' | 'audio' | null
}

interface Row { words: string; tone: KindTone; bucket: KindBucket; preview?: FileKind['previewable'] }

const TABLE: Record<string, Row> = {
  png: { words: 'png', tone: 'image', bucket: 'image', preview: 'image' },
  jpg: { words: 'jpeg', tone: 'image', bucket: 'image', preview: 'image' },
  jpeg: { words: 'jpeg', tone: 'image', bucket: 'image', preview: 'image' },
  webp: { words: 'webp', tone: 'image', bucket: 'image', preview: 'image' },
  gif: { words: 'gif', tone: 'image', bucket: 'image', preview: 'image' },
  heic: { words: 'heic', tone: 'image', bucket: 'image' },
  tif: { words: 'tiff', tone: 'image', bucket: 'image' },
  tiff: { words: 'tiff', tone: 'image', bucket: 'image' },
  svg: { words: 'svg', tone: 'neutral', bucket: 'image', preview: 'image' },
  ai: { words: 'illustrator', tone: 'source', bucket: 'other' },
  eps: { words: 'eps', tone: 'source', bucket: 'other' },
  psd: { words: 'photoshop', tone: 'source', bucket: 'other' },
  indd: { words: 'indesign', tone: 'source', bucket: 'other' },
  fig: { words: 'figma', tone: 'source', bucket: 'other' },
  sketch: { words: 'sketch', tone: 'source', bucket: 'other' },
  aep: { words: 'afterEffects', tone: 'source', bucket: 'other' },
  prproj: { words: 'premiere', tone: 'source', bucket: 'other' },
  mp4: { words: 'video', tone: 'media', bucket: 'video', preview: 'video' },
  mov: { words: 'video', tone: 'media', bucket: 'video', preview: 'video' },
  webm: { words: 'video', tone: 'media', bucket: 'video', preview: 'video' },
  m4v: { words: 'video', tone: 'media', bucket: 'video', preview: 'video' },
  avi: { words: 'video', tone: 'media', bucket: 'video' },
  mp3: { words: 'audio', tone: 'media', bucket: 'video', preview: 'audio' },
  wav: { words: 'audio', tone: 'media', bucket: 'video', preview: 'audio' },
  m4a: { words: 'audio', tone: 'media', bucket: 'video', preview: 'audio' },
  pdf: { words: 'pdf', tone: 'pdf', bucket: 'document', preview: 'pdf' },
  doc: { words: 'word', tone: 'media', bucket: 'document' },
  docx: { words: 'word', tone: 'media', bucket: 'document' },
  xls: { words: 'excel', tone: 'media', bucket: 'document' },
  xlsx: { words: 'excel', tone: 'media', bucket: 'document' },
  csv: { words: 'csv', tone: 'media', bucket: 'document' },
  ppt: { words: 'powerpoint', tone: 'media', bucket: 'document' },
  pptx: { words: 'powerpoint', tone: 'media', bucket: 'document' },
  key: { words: 'keynote', tone: 'media', bucket: 'document' },
  txt: { words: 'text', tone: 'neutral', bucket: 'document' },
  zip: { words: 'zip', tone: 'neutral', bucket: 'other' },
  rar: { words: 'zip', tone: 'neutral', bucket: 'other' },
  '7z': { words: 'zip', tone: 'neutral', bucket: 'other' },
  ttf: { words: 'font', tone: 'neutral', bucket: 'other' },
  otf: { words: 'font', tone: 'neutral', bucket: 'other' },
  woff: { words: 'font', tone: 'neutral', bucket: 'other' },
  woff2: { words: 'font', tone: 'neutral', bucket: 'other' },
}

const BY_TYPE: [RegExp, string][] = [
  [/^image\/png$/, 'png'], [/^image\/jpe?g$/, 'jpg'], [/^image\/svg/, 'svg'], [/^image\//, 'webp'],
  [/^video\//, 'mp4'], [/^audio\//, 'mp3'], [/^application\/pdf$/, 'pdf'],
  [/wordprocessingml|msword/, 'docx'], [/spreadsheetml|ms-excel/, 'xlsx'], [/presentationml|ms-powerpoint/, 'pptx'],
]

/** The extension after the last dot, lower-cased; '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The name without its extension — what Rename edits (ADR-0134 d.8). */
export function baseOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function fileKind(name: string, contentType?: string | null, isLink = false): FileKind {
  if (isLink) return { badge: 'LINK', wordsKey: 'link', tone: 'link', bucket: 'link', previewable: null }
  let ext = extensionOf(name)
  if (!TABLE[ext] && contentType) ext = BY_TYPE.find(([re]) => re.test(contentType))?.[1] ?? ext
  const row = TABLE[ext]
  if (!row) return { badge: (ext || 'FILE').slice(0, 4).toUpperCase(), wordsKey: ext ? 'generic' : 'file', tone: 'neutral', bucket: 'other', previewable: null }
  return { badge: ext.slice(0, 4).toUpperCase(), wordsKey: row.words, tone: row.tone, bucket: row.bucket, previewable: row.preview ?? null }
}

/** `0:06`, `1:02:15` — a video or sound's running time. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** `48 KB`, `3.4 MB`, `3.1 GB`. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** The most one file can be (ADR-0134 d.12, Edward 1 Oct: 5 GB). The function refuses the same number. */
export const MAX_FILE_BYTES = 5 * 1024 ** 3

/** Which service a link points at, for its kind line: "Link · Google Drive". */
export function linkService(url: string): string | null {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  if (host.endsWith('drive.google.com') || host.endsWith('docs.google.com')) return 'Google Drive'
  if (host.endsWith('dropbox.com')) return 'Dropbox'
  if (host.endsWith('wetransfer.com') || host === 'we.tl') return 'WeTransfer'
  if (host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com') || host === '1drv.ms') return 'OneDrive'
  if (host.endsWith('frame.io')) return 'Frame.io'
  if (host.endsWith('vimeo.com')) return 'Vimeo'
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube'
  return host.replace(/^www\./, '')
}
