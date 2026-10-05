import { fileKind } from './kind'

/**
 * Grid pictures, made in the browser at upload (ADR-0134 d.26): an image drawn small on a canvas, a
 * PDF's first page through `pdfjs-dist` (Apache-2.0, loaded only when a PDF is uploaded, so it is not
 * in the main bundle), both as a WebP no wider or taller than 320 px. A video's or a sound's running
 * time is read from a media element's metadata.
 *
 * Every function here resolves to null on any failure — a picture that cannot be made never fails
 * the upload; the Library shows the kind tile instead.
 */

export const THUMB_MAX_PX = 320
/** Past these sizes the picture is skipped: decoding a huge file in the tab is not worth a 320 px tile. */
const IMAGE_LIMIT_BYTES = 60 * 1024 ** 2
const PDF_LIMIT_BYTES = 150 * 1024 ** 2
const METADATA_TIMEOUT_MS = 8000

/** The size a picture is drawn at: the longest side becomes at most 320, never enlarged. */
export function thumbSize(width: number, height: number, max = THUMB_MAX_PX): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: max, height: max }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Which picture a file can have: an image, a PDF's first page, or none. */
export function thumbSource(file: { name: string; type: string; size: number }): 'image' | 'pdf' | null {
  const k = fileKind(file.name, file.type)
  if (k.previewable === 'image' && file.size <= IMAGE_LIMIT_BYTES) return 'image'
  if (k.previewable === 'pdf' && file.size <= PDF_LIMIT_BYTES) return 'pdf'
  return null
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.82)
    } catch {
      resolve(null)
    }
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')) }
    img.src = url
  })
}

async function imageThumb(file: File): Promise<Blob | null> {
  const img = await loadImage(file)
  const { width, height } = thumbSize(img.naturalWidth || img.width, img.naturalHeight || img.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, width, height)
  return canvasToWebp(canvas)
}

async function pdfThumb(file: File): Promise<Blob | null> {
  // Both the library and its worker are fetched only now — Vite splits them into their own chunks.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const { width } = thumbSize(base.width, base.height)
    const viewport = page.getViewport({ scale: width / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    return await canvasToWebp(canvas)
  } finally {
    void task.destroy()
  }
}

/** A ≤320 px WebP picture of the file, or null when it has none or it could not be made. */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  try {
    const source = thumbSource(file)
    if (source === 'image') return await imageThumb(file)
    if (source === 'pdf') return await pdfThumb(file)
    return null
  } catch {
    return null
  }
}

/** Seconds of a video or sound, or null when it is neither or the browser cannot read it. */
export async function readDuration(file: File): Promise<number | null> {
  const k = fileKind(file.name, file.type)
  const tag = k.previewable === 'video' ? 'video' : k.previewable === 'audio' ? 'audio' : null
  if (!tag) return null
  try {
    return await new Promise<number | null>((resolve) => {
      const el = document.createElement(tag)
      const url = URL.createObjectURL(file)
      const finish = (v: number | null) => {
        clearTimeout(timer)
        el.removeAttribute('src')
        URL.revokeObjectURL(url)
        resolve(v)
      }
      const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS)
      el.preload = 'metadata'
      el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 100) / 100 : null)
      el.onerror = () => finish(null)
      el.src = url
    })
  } catch {
    return null
  }
}
