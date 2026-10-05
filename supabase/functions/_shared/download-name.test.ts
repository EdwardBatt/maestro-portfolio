import { describe, expect, it } from 'vitest'
import { contentDisposition, nameFromObjectKey, versionedName } from './download-name.ts'

describe('contentDisposition', () => {
  it('sends the plain name in both forms', () => {
    expect(contentDisposition('Harmony Brief v2.pdf')).toBe(
      `attachment; filename="Harmony Brief v2.pdf"; filename*=UTF-8''Harmony%20Brief%20v2.pdf`,
    )
  })

  it('keeps an ASCII fallback when the name is Arabic', () => {
    // The whole point of emitting both: a client that ignores `filename*` must still get
    // something, and that something must not be the uuid key.
    const header = contentDisposition('موجز.pdf')
    expect(header).toContain('filename="____.pdf"')
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('موجز.pdf')}`)
  })

  it('escapes the RFC 5987 characters encodeURIComponent leaves alone', () => {
    expect(contentDisposition("brief (final)'s*.pdf")).toContain(
      `filename*=UTF-8''brief%20%28final%29%27s%2A.pdf`,
    )
  })

  it('strips header-injection characters rather than escaping them', () => {
    const header = contentDisposition('a"b\\c\r\nX-Evil: 1.pdf')
    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
    expect(header).toContain('filename="a_b_c__X-Evil: 1.pdf"')
  })

  it('falls back to a usable name when there is none', () => {
    expect(contentDisposition('')).toContain('filename="file"')
    expect(contentDisposition('   ')).toContain('filename="file"')
  })
})

describe('nameFromObjectKey', () => {
  it('drops the tenant/client/folder path and the uuid prefix', () => {
    expect(
      nameFromObjectKey(
        '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/' +
          '33333333-3333-4333-8333-333333333333/a3f9c1e2-1234-4abc-9def-0123456789ab-Harmony_Brief_v2.pdf',
      ),
    ).toBe('Harmony_Brief_v2.pdf')
  })

  it('leaves a key alone when it carries no uuid prefix', () => {
    expect(nameFromObjectKey('tenant/legacy-import.pdf')).toBe('legacy-import.pdf')
  })

  it('decodes the percent-encoding the signer applies per segment', () => {
    expect(
      nameFromObjectKey('t/c/f/a3f9c1e2-1234-4abc-9def-0123456789ab-Key%20Visual.png'),
    ).toBe('Key Visual.png')
  })

  it('never returns an empty name', () => {
    expect(nameFromObjectKey('')).toBe('file')
    expect(nameFromObjectKey('t/c/f/a3f9c1e2-1234-4abc-9def-0123456789ab-')).toBe('file')
  })
})

describe('versionedName', () => {
  it('puts the version before the extension, so the file still opens', () => {
    expect(versionedName('Harmony Brief.pdf', 3)).toBe('Harmony Brief v3.pdf')
  })

  it('distinguishes two rounds of the same file — the reason it exists', () => {
    // Without this the browser receives two identical names and silently calls the second
    // `Harmony Brief (1).pdf`, on the one surface whose job is telling rounds apart.
    expect(versionedName('Harmony Brief.pdf', 1)).not.toBe(versionedName('Harmony Brief.pdf', 3))
  })

  it('appends to a name with no extension', () => {
    expect(versionedName('storyboard', 2)).toBe('storyboard v2')
  })

  it('treats a leading dot as the whole name, not an extension', () => {
    expect(versionedName('.gitignore', 4)).toBe('.gitignore v4')
  })

  it('uses only the LAST dot, so a dotted name keeps its real extension', () => {
    expect(versionedName('brief.final.v2.docx', 5)).toBe('brief.final.v2 v5.docx')
  })

  it('never produces an empty name', () => {
    expect(versionedName('', 1)).toBe('file v1')
    expect(versionedName('   ', 1)).toBe('file v1')
  })
})
