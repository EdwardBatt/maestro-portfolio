/**
 * Client-side text extraction for brief ingestion (ADR-0044 §1).
 *
 * Extraction is client-side, inference is server-side: `.docx` is unzipped and read in
 * the browser, `.txt`/`.md` are read directly, and only the resulting **plain text**
 * ever leaves the machine. The document bytes are never posted to the model.
 *
 * NOT shared with Deno — this one runs in the browser only, so it may use npm imports.
 * `mammoth` is loaded with a dynamic `import()` so its ten transitive dependencies stay
 * out of the main chunk (the bundle is already over Vite's 500 kB warning), and a user
 * who only ever pastes text never downloads it.
 *
 * PDF is refused and stays refused (ADR-0044 Context): PDF extraction returns layout
 * fragments rather than prose, which is the worst combination — plausible output from
 * mangled input, with no way for the user to tell.
 */
import { MAX_BRIEF_CHARS } from './fields.ts'

export type BriefExtractionCode =
  | 'pdf_unsupported'
  | 'legacy_doc_unsupported'
  | 'unsupported_type'
  | 'too_long'
  | 'empty'
  | 'extract_failed'

/** A refusal the wizard can turn into a specific message. Never carries file contents. */
export class BriefExtractionError extends Error {
  readonly code: BriefExtractionCode
  constructor(code: BriefExtractionCode) {
    super(code)
    this.name = 'BriefExtractionError'
    this.code = code
  }
}

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown'] as const

/** Extensions offered to the file picker. Keep in step with the checks below. */
export const ACCEPTED_BRIEF_FILE_TYPES = '.docx,.txt,.md'

function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at === -1 ? '' : name.slice(at).toLowerCase()
}

/**
 * Refuse over-cap text rather than truncating it (ADR-0044 §2). This is the client's
 * copy of the rule; `ingest-brief` enforces the same cap server-side, because the
 * client's copy is a courtesy and the server's is the boundary.
 */
export function assertBriefTextUsable(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new BriefExtractionError('empty')
  if (trimmed.length > MAX_BRIEF_CHARS) throw new BriefExtractionError('too_long')
  return trimmed
}

/**
 * Read a brief document as plain text. Throws `BriefExtractionError` for anything it
 * will not handle — the caller shows the matching message and the wizard stays usable.
 */
export async function extractBriefText(file: File): Promise<string> {
  const ext = extensionOf(file.name)

  if (ext === '.pdf') throw new BriefExtractionError('pdf_unsupported')
  if (ext === '.doc') throw new BriefExtractionError('legacy_doc_unsupported')

  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) {
    return assertBriefTextUsable(await file.text())
  }

  if (ext === '.docx') {
    let raw: string
    try {
      // Dynamic on purpose — see the module comment. `extractRawText` gives paragraphs
      // separated by newlines, which is exactly what the heading matcher wants.
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      raw = result.value
    } catch {
      // A corrupt or password-protected .docx lands here. The detail is useless to the
      // user and may quote document content, so it is not surfaced.
      throw new BriefExtractionError('extract_failed')
    }
    return assertBriefTextUsable(raw)
  }

  throw new BriefExtractionError('unsupported_type')
}
