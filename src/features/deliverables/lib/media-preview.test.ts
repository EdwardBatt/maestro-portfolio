import { describe, expect, it } from 'vitest'
import { isInlinePreviewable, previewKind } from './media-preview'

describe('media preview kind (ADR-0025)', () => {
  it('web-native images render inline', () => {
    expect(previewKind('image/png')).toBe('image')
    expect(previewKind('image/jpeg')).toBe('image')
    expect(previewKind('image/webp')).toBe('image')
  })

  it('web-native video renders inline', () => {
    expect(previewKind('video/mp4')).toBe('video')
    expect(previewKind('video/webm')).toBe('video')
  })

  it('pdf renders inline', () => {
    expect(previewKind('application/pdf')).toBe('pdf')
  })

  it('non-web-playable types fall back to other (download/link-out)', () => {
    expect(previewKind('video/quicktime')).toBe('other') // ProRes / .mov
    expect(previewKind('image/vnd.adobe.photoshop')).toBe('other') // PSD
    expect(previewKind('application/postscript')).toBe('other') // AI
    expect(previewKind(null)).toBe('other')
  })

  it('ignores charset parameters and case', () => {
    expect(previewKind('IMAGE/PNG; charset=binary')).toBe('image')
    expect(isInlinePreviewable('application/pdf')).toBe(true)
    expect(isInlinePreviewable('application/zip')).toBe(false)
  })
})
