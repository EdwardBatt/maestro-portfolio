/**
 * How a review version previews in-app (ADR-0025 §6). Web-native types render inline; everything
 * else falls back to download / link-out (OD 17 stays open — no transcoding this phase).
 */

export type PreviewKind = 'image' | 'video' | 'pdf' | 'other'

const IMAGE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']
const VIDEO = ['video/mp4', 'video/webm', 'video/ogg']

/** Map a MIME type to how the viewer should present it. Unknown / non-web-playable → 'other'. */
export function previewKind(contentType: string | null | undefined): PreviewKind {
  if (!contentType) return 'other'
  const c = contentType.toLowerCase().split(';')[0].trim()
  if (IMAGE.includes(c)) return 'image'
  if (VIDEO.includes(c)) return 'video'
  if (c === 'application/pdf') return 'pdf'
  return 'other'
}

/** Inline-renderable (image/video/pdf) vs must download/link-out (other). */
export function isInlinePreviewable(contentType: string | null | undefined): boolean {
  return previewKind(contentType) !== 'other'
}
