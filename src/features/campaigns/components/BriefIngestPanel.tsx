import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NoticeBox } from '../../../components/NoticeBox'
import { Button } from '../../../components/Button'
import { BusyDialog } from '../../../components/Notice'
import {
  ACCEPTED_BRIEF_FILE_TYPES,
  BriefExtractionError,
  assertBriefTextUsable,
  extractBriefText,
  type BriefExtractionCode,
} from '../../../lib/brief/extract'
import {
  BriefIngestRefusedError,
  BriefTooLongError,
  useIngestBrief,
  type BriefIngestResult,
} from '../api/brief-ingest-api'

/**
 * "Fill from a brief document" — the ingest control on the Strategy step (ADR-0044).
 *
 * The document is read in the browser and only its plain text is sent onward; the file
 * itself is handed back to the wizard so it can be filed in the campaign's References
 * folder after submit (§8). The button is disabled while a call is in flight, which is
 * half of "cost is bounded per use" (§9) — one call per ingest, initiated by a person.
 */
export interface BriefIngestPanelProps<R = BriefIngestResult> {
  /** The wizard merges the result (empty fields only) and decides what to say about it. */
  onIngested: (result: R, sourceFile: File | null) => void
  /**
   * ADR-0084 d.6: a different TARGET for the same document. The default reads the campaign
   * brief's fourteen fields; the single-job flow passes an ingest built against the
   * `single_execution` template. The panel is the same either way — choose, extract, run — which
   * is the point: one way to read a document, whichever brief it lands in.
   */
  ingest?: (text: string) => Promise<R>
  /** Optional heading override. The default is the campaign wizard's. */
  title?: string
  /** The wizard's own outcome message — how many fields were filled, or the fallback notice. */
  statusMessage?: string | null
  /** True when the outcome message is a warning (fallback ran, or nothing matched). */
  statusIsWarning?: boolean
  /**
   * SJ-v3-02 (22 Sep): one row — an icon, "Got a brief already? Drop it here", the accepted
   * formats, a Choose button. A file chosen or dropped is READ AT ONCE (no second press); the
   * paste mode keeps its textarea and button. Same handlers, same testids, no heading of its own.
   */
  compact?: boolean
  /** Compact only: what is said about where the chosen file is filed. The single job's words by default. */
  sourceNoteKey?: string
}

type PanelError =
  | BriefExtractionCode
  | 'no_input'
  | 'ingest_failed'
  | BriefIngestRefusedError['code']

export function BriefIngestPanel<R = BriefIngestResult>({
  onIngested,
  ingest: customIngest,
  title,
  statusMessage,
  statusIsWarning,
  compact = false,
  sourceNoteKey = 'campaigns.ingest.sourceNoteJob',
}: BriefIngestPanelProps<R>) {
  const { t } = useTranslation()
  const ingest = useIngestBrief()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pasted, setPasted] = useState('')
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [error, setError] = useState<PanelError | null>(null)
  /** A custom ingest is a plain promise, so its in-flight state is tracked here. */
  const [customBusy, setCustomBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const busy = ingest.isPending || customBusy
  const hasInput = mode === 'file' ? file !== null : pasted.trim().length > 0

  function chooseFile(next: File | null) {
    setError(null)
    setFile(next)
    // Compact: choosing IS the instruction to read — the row has no second button.
    if (compact && next) void run(next)
  }

  async function run(chosen: File | null = file) {
    setError(null)
    let text: string
    try {
      if (mode === 'paste') {
        text = assertBriefTextUsable(pasted)
      } else if (chosen) {
        text = await extractBriefText(chosen)
      } else {
        setError('no_input')
        return
      }
    } catch (e) {
      setError(e instanceof BriefExtractionError ? e.code : 'ingest_failed')
      return
    }

    try {
      let result: R
      if (customIngest) {
        setCustomBusy(true)
        try {
          result = await customIngest(text)
        } finally {
          setCustomBusy(false)
        }
      } else {
        result = (await ingest.mutateAsync({ text })) as unknown as R
      }
      onIngested(result, mode === 'file' ? chosen : null)
    } catch (e) {
      // Only deliberate refusals reach here — an over-cap document, or a "no" the server
      // meant. Everything that is genuinely an outage has already become a heading-matched
      // result inside the mutation, so it never presents as an error the user must act on.
      if (e instanceof BriefTooLongError) setError('too_long')
      else if (e instanceof BriefIngestRefusedError) setError(e.code)
      else setError('ingest_failed')
    }
  }

  if (compact) {
    return (
      <section
        className={`brief-ingest is-compact${dragOver ? ' is-drag-over' : ''}`}
        data-testid="brief-ingest"
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (busy) return
          const dropped = e.dataTransfer.files?.[0] ?? null
          if (dropped) { setMode('file'); chooseFile(dropped) }
        }}
      >
        {busy && <BusyDialog text={t('campaigns.ingest.running')} testId="brief-ingest-busy" />}
        {mode === 'file' ? (
          <div className="brief-drop">
            <span className="brief-drop-icon" aria-hidden="true"><DropGlyph /></span>
            <span className="brief-drop-text">
              <span className="brief-drop-title">{t('campaigns.ingest.dropTitle')}</span>
              <span className="brief-drop-sub" data-testid="brief-ingest-intro">{t('campaigns.ingest.dropSub')}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={busy} data-testid="brief-ingest-choose">
              {t('campaigns.ingest.chooseFileShort')}
            </Button>
            <input
              ref={fileInput}
              id="brief-ingest-file"
              type="file"
              accept={ACCEPTED_BRIEF_FILE_TYPES}
              hidden
              disabled={busy}
              onChange={(e) => { chooseFile(e.target.files?.[0] ?? null); e.target.value = '' }}
              data-testid="brief-ingest-file"
            />
          </div>
        ) : (
          <div className="brief-ingest-input">
            <label htmlFor="brief-ingest-paste">{t('campaigns.ingest.pasteLabel')}</label>
            <textarea
              id="brief-ingest-paste"
              rows={5}
              value={pasted}
              disabled={busy}
              onChange={(e) => { setError(null); setPasted(e.target.value) }}
              data-testid="brief-ingest-paste"
            />
            <div className="brief-ingest-actions">
              <Button type="button" variant="primary" size="sm" busy={busy} onClick={() => run()} disabled={!hasInput} data-testid="brief-ingest-run">
                {busy ? t('campaigns.ingest.running') : t('campaigns.ingest.run')}
              </Button>
            </div>
          </div>
        )}
        <div className="brief-drop-foot">
          <Button variant="link" size="sm" disabled={busy} onClick={() => { setError(null); setMode((m) => (m === 'file' ? 'paste' : 'file')) }} data-testid="brief-ingest-toggle-mode">
            {t(mode === 'file' ? 'campaigns.ingest.pasteToggle' : 'campaigns.ingest.fileToggle')}
          </Button>
          {file && mode === 'file' && (
            <span className="muted" data-testid="brief-ingest-source-note">{t(sourceNoteKey, { name: file.name })}</span>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert" data-testid="brief-ingest-error">{t(`campaigns.ingest.error.${error}`)}</p>
        )}
        {!error && statusMessage && (
          <p className={statusIsWarning ? 'form-error' : 'muted'} role="status" data-testid="brief-ingest-status">{statusMessage}</p>
        )}
      </section>
    )
  }

  return (
    <section className="brief-ingest" data-testid="brief-ingest">
      {/* ADR-0092 d.1 / I48.8: reading a document is a model call that spans seconds — a blocking
          "please wait" modal, not only a button spinner, so nobody wonders whether it is working. */}
      {busy && <BusyDialog text={t('campaigns.ingest.running')} testId="brief-ingest-busy" />}
      <h2 className="org-section-heading">{title ?? t('campaigns.ingest.title')}</h2>
      <NoticeBox testId="brief-ingest-intro" lines={[t('campaigns.ingest.intro')]} />

      {mode === 'file' ? (
        <div className="brief-ingest-input">
          <span className="field-label">{t('campaigns.ingest.chooseFile')}</span>
          {/* The browser's default file control was on screen until 5 Sep — grey box, hard border,
              black label, in the middle of a styled form. It is a button like every other. */}
          <div className="receipt-input">
            <Button
              variant="primary"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              data-testid="brief-ingest-choose"
            >
              {`↑ ${t('campaigns.ingest.chooseFileButton')}`}
            </Button>
            <span className="muted" data-testid="brief-ingest-filename">
              {file ? file.name : t('campaigns.ingest.noFileChosen')}
            </span>
          </div>
          <input
            ref={fileInput}
            id="brief-ingest-file"
            type="file"
            accept={ACCEPTED_BRIEF_FILE_TYPES}
            hidden
            disabled={busy}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            data-testid="brief-ingest-file"
          />
          <NoticeBox testId="brief-ingest-hint" lines={[t('campaigns.ingest.fileHint')]} />
          {file && (
            <p className="muted" data-testid="brief-ingest-source-note">
              {t('campaigns.ingest.sourceNote', { name: file.name })}
            </p>
          )}
        </div>
      ) : (
        <div className="brief-ingest-input">
          <label htmlFor="brief-ingest-paste">{t('campaigns.ingest.pasteLabel')}</label>
          <textarea
            id="brief-ingest-paste"
            rows={6}
            value={pasted}
            disabled={busy}
            onChange={(e) => {
              setError(null)
              setPasted(e.target.value)
            }}
            data-testid="brief-ingest-paste"
          />
        </div>
      )}

      <div className="brief-ingest-actions">
        {/* Button, not a bespoke spinner: a model call takes seconds and the wizard has
            no other sign it is working, which is the exact "dead click" this component was
            built for. One affordance everywhere (AGENTS.md §4). */}
        <Button
          type="button"
          variant="primary"
          busy={busy}
          onClick={() => run()}
          disabled={!hasInput}
          data-testid="brief-ingest-run"
        >
          {busy ? t('campaigns.ingest.running') : t('campaigns.ingest.run')}
        </Button>
        <Button
          variant="link"
          disabled={busy}
          onClick={() => {
            setError(null)
            setMode((m) => (m === 'file' ? 'paste' : 'file'))
          }}
          data-testid="brief-ingest-toggle-mode"
        >
          {t(mode === 'file' ? 'campaigns.ingest.pasteToggle' : 'campaigns.ingest.fileToggle')}
        </Button>
      </div>

      {error && (
        <p className="form-error" role="alert" data-testid="brief-ingest-error">
          {t(`campaigns.ingest.error.${error}`)}
        </p>
      )}
      {!error && statusMessage && (
        <p
          className={statusIsWarning ? 'form-error' : 'muted'}
          role="status"
          data-testid="brief-ingest-status"
        >
          {statusMessage}
        </p>
      )}
    </section>
  )
}

function DropGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 12V3M5.5 6.5L9 3l3.5 3.5M3 12v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
