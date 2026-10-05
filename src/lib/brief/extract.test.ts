// ADR-0044 §1: extraction is client-side, PDF is refused, and over-cap text is refused
// rather than truncated. `mammoth` is mocked — the point under test is the routing and the
// refusals, not the .docx unzipper.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BriefExtractionError, assertBriefTextUsable, extractBriefText } from './extract'
import { MAX_BRIEF_CHARS } from './fields'

const extractRawText = vi.fn()
vi.mock('mammoth', () => ({
  default: { extractRawText: (input: unknown) => extractRawText(input) },
  extractRawText: (input: unknown) => extractRawText(input),
}))

function file(name: string, contents = 'Background\nSomething true.'): File {
  return new File([contents], name, { type: 'text/plain' })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'no_error'
  } catch (e) {
    return e instanceof BriefExtractionError ? e.code : `unexpected:${String(e)}`
  }
}

afterEach(() => extractRawText.mockReset())

describe('extractBriefText (ADR-0044 §1)', () => {
  it('reads .txt and .md directly', async () => {
    expect(await extractBriefText(file('brief.txt'))).toBe('Background\nSomething true.')
    expect(await extractBriefText(file('brief.md'))).toBe('Background\nSomething true.')
    expect(extractRawText).not.toHaveBeenCalled()
  })

  it('reads .docx through mammoth, loaded on demand', async () => {
    extractRawText.mockResolvedValue({ value: 'Background\nFrom a Word file.' })
    const result = await extractBriefText(file('brief.docx'))
    expect(result).toBe('Background\nFrom a Word file.')
    expect(extractRawText).toHaveBeenCalledTimes(1)
  })

  it('refuses PDF with its own code, so the wizard can say what to do instead', async () => {
    expect(await codeOf(extractBriefText(file('brief.pdf')))).toBe('pdf_unsupported')
  })

  it('refuses legacy .doc separately from an unknown type', async () => {
    expect(await codeOf(extractBriefText(file('brief.doc')))).toBe('legacy_doc_unsupported')
    expect(await codeOf(extractBriefText(file('brief.pages')))).toBe('unsupported_type')
    expect(await codeOf(extractBriefText(file('brief')))).toBe('unsupported_type')
  })

  it('refuses an over-cap document rather than truncating it', async () => {
    const oversized = file('brief.txt', 'x'.repeat(MAX_BRIEF_CHARS + 1))
    expect(await codeOf(extractBriefText(oversized))).toBe('too_long')
  })

  it('refuses a document that extracts to nothing (a scan, or an empty file)', async () => {
    extractRawText.mockResolvedValue({ value: '   \n  ' })
    expect(await codeOf(extractBriefText(file('scan.docx')))).toBe('empty')
    expect(await codeOf(extractBriefText(file('empty.txt', '')))).toBe('empty')
  })

  it('turns a corrupt .docx into a refusal, not a leaked parser error', async () => {
    extractRawText.mockRejectedValue(new Error('End of central directory not found — /Users/x/brief.docx'))
    expect(await codeOf(extractBriefText(file('corrupt.docx')))).toBe('extract_failed')
  })
})

describe('assertBriefTextUsable', () => {
  it('accepts text exactly at the cap and refuses one character more', () => {
    expect(assertBriefTextUsable('y'.repeat(MAX_BRIEF_CHARS))).toHaveLength(MAX_BRIEF_CHARS)
    expect(() => assertBriefTextUsable('y'.repeat(MAX_BRIEF_CHARS + 1))).toThrow(
      BriefExtractionError,
    )
  })

  it('refuses whitespace-only pasted text', () => {
    expect(() => assertBriefTextUsable('   \n\t ')).toThrow(BriefExtractionError)
  })
})
