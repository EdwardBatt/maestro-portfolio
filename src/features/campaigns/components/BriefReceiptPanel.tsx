import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReceiptReadRefusedError,
  useReadBriefReceipt,
  useReceiptTimeZones,
} from '../api/brief-receipt-api'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { InfoTip } from '../../../components/InfoTip'
import { DateField } from '../../../components/DateField'

/**
 * Evidence that a brief was issued, and when (ADR-0066) — step 1 of the wizard.
 *
 * A screenshot of the request as it arrived: Outlook, WhatsApp, Teams. The model READS the
 * subject, the date and the time off it and PROPOSES them; a person glances and confirms. The
 * confirmed timestamp is what starts the T+ clock (d.5), and the image is the record any argument
 * would be settled by (d.6).
 *
 * WHY THE FIELDS ARE EDITABLE AND MARKED, rather than either read-only or plain. Read-only would
 * make an unchecked machine reading the origin of an accountability measure, which is the one
 * thing d.4 exists to prevent. Plain would hide that a machine produced them. Marked-until-touched
 * is the pattern the wizard already uses for ingested brief fields (ADR-0044 §5), applied to three
 * more.
 *
 * WHY A PARTIAL READING IS NORMAL AND NOT AN ERROR (d.13). WhatsApp shows `14:32` for anything
 * received today; mail shows `Yesterday 09:15`. The model is forbidden from completing those,
 * because completing one is an inference. So an empty date after a successful read is the system
 * working, and the panel asks for it rather than reporting a failure.
 *
 * NOTHING IS SAVED HERE. The image and the values are handed up; the wizard files the screenshot
 * and writes the receipt when the draft campaign exists, one Next press away.
 */

export interface ReceiptDraft {
  /** The screenshot itself. Null until one is chosen or pasted. */
  image: File | null
  subject: string
  /** `YYYY-MM-DD`, or empty while a person still has to supply it. */
  receivedDate: string
  /** `HH:MM`, or empty. */
  receivedTime: string
  timeZone: string
  /** Whether the model produced the values, for the audit the row keeps. */
  source: 'model' | 'manual'
  /** True once both halves are present and the person has said so. */
  confirmed: boolean
}

export const EMPTY_RECEIPT: ReceiptDraft = {
  image: null,
  subject: '',
  receivedDate: '',
  receivedTime: '',
  timeZone: '',
  source: 'manual',
  confirmed: false,
}

export interface BriefReceiptPanelProps {
  value: ReceiptDraft
  onChange: (next: ReceiptDraft) => void
  /**
   * A short-lived URL for the screenshot already filed against this campaign, when there is one and
   * no new file has been chosen. The wizard resolves it; this component only shows it.
   */
  filedUrl?: string | null
  /** Inside a card that already names the section (SJ-v3-01, 22 Sep): no heading, no box of its own. */
  compact?: boolean
  /**
   * Fields the host wants on the same row as the screenshot buttons (SJ-v3-01: who asked, how it
   * arrived, then the proof). Given, the buttons sit in that row under `proofLabel`, and what opens
   * beneath them — the arrival fields, the preview — runs the full width below the row.
   */
  leading?: ReactNode
  proofLabel?: ReactNode
}

/** Reading a File as a `data:` URL, which is what the function takes. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'))
    reader.readAsDataURL(file)
  })
}

export function BriefReceiptPanel({ value, onChange, filedUrl, compact = false, leading, proofLabel }: BriefReceiptPanelProps) {
  const { t } = useTranslation()
  const read = useReadBriefReceipt()
  const zones = useReceiptTimeZones()
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Which fields the model filled and nobody has touched — the ADR-0044 §5 marker. */
  const [machineFilled, setMachineFilled] = useState<string[]>([])
  // Record the arrival by hand — for a request that came by phone, or one the model cannot read.
  const [manualEntry, setManualEntry] = useState(false)

  // Default the zone to the confirming person's office once it is known (d.14).
  useEffect(() => {
    if (!value.timeZone && zones.data?.mine) onChange({ ...value, timeZone: zones.data.mine })
  }, [zones.data?.mine, value, onChange])

  /**
   * The preview has two sources, and the order matters.
   *
   * A `File` cannot be serialised into the wizard's draft, so a screenshot chosen on a previous
   * visit is gone from state the moment the form is resumed — while the image itself is filed in
   * the Library and the receipt row points straight at it. Until 5 Sep nothing read it back, so
   * the panel showed an empty picker over evidence that had been captured weeks earlier, and the
   * obvious response to that is to upload it again (I40).
   *
   * A file just chosen wins: it is what the person is looking at, and it is what will replace the
   * filed one on the next Next.
   */
  useEffect(() => {
    if (!value.image) {
      setPreview(filedUrl ?? null)
      return
    }
    const url = URL.createObjectURL(value.image)
    setPreview(url)
    // Object URLs are a real allocation; releasing them is not optional in a long-lived form.
    return () => URL.revokeObjectURL(url)
  }, [value.image, filedUrl])

  async function accept(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError(t('campaigns.receipt.notAnImage'))
      return
    }
    // Show it immediately; the reading catches up. A screenshot the person can already see is
    // reassurance that the right thing was pasted, before any model call resolves.
    const next: ReceiptDraft = { ...value, image: file, confirmed: false }
    onChange(next)

    let dataUrl: string
    try {
      dataUrl = await toDataUrl(file)
    } catch {
      setError(t('campaigns.receipt.readFailed'))
      return
    }

    read.mutate(
      { image: dataUrl },
      {
        onSuccess: (reading) => {
          // Only fields the model actually produced are marked; an empty one is a question,
          // not a machine answer.
          setMachineFilled(
            [
              reading.subject ? 'subject' : null,
              reading.receivedDate ? 'receivedDate' : null,
              reading.receivedTime ? 'receivedTime' : null,
            ].filter((k): k is string => k !== null),
          )
          onChange({
            ...next,
            subject: reading.subject || next.subject,
            receivedDate: reading.receivedDate || next.receivedDate,
            receivedTime: reading.receivedTime || next.receivedTime,
            source: 'model',
            confirmed: false,
          })
        },
        onError: (e) => {
          // The screenshot is still evidence and is still kept; only the typing was not saved.
          const code = e instanceof ReceiptReadRefusedError ? e.code : 'unavailable'
          setError(t(`campaigns.receipt.error.${code}`, { defaultValue: t('campaigns.receipt.error.unavailable') }))
        },
      },
    )
  }

  function onPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    void accept(file)
  }

  function edit(patch: Partial<ReceiptDraft>, touched?: string) {
    if (touched) setMachineFilled((keys) => keys.filter((k) => k !== touched))
    // Any edit un-confirms: what was agreed to is no longer what is on screen.
    onChange({ ...value, ...patch, confirmed: false })
  }

  const complete = Boolean(value.receivedDate && value.receivedTime)
  const marker = (key: string) =>
    machineFilled.includes(key) ? (
      <span className="field-marker" data-testid={`receipt-marked-${key}`}>
        {t('campaigns.receipt.fromScreenshot')}
      </span>
    ) : null

  const inputs = (
    <div className="receipt-input">
      <Button
        variant="primary"
        onClick={() => fileInput.current?.click()}
        disabled={read.isPending}
        data-testid="receipt-choose"
      >
        {`↑ ${t('campaigns.receipt.choose')}`}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void accept(file)
        }}
        data-testid="receipt-file"
      />
      {/* A visible target, not a sentence: people paste into things that look like inputs. The
          section already handles the paste event, so this is an affordance, not a second path. */}
      <span className="paste-target" data-testid="receipt-paste-target">
        {t('campaigns.receipt.orPaste')}
      </span>
    </div>
  )

  return (
    <section className={`brief-receipt${compact ? ' is-compact' : ''}`} data-testid="brief-receipt" onPaste={onPaste}>
      {/* d.10 / the ADR's named consequence: an inbox screenshot carries other people's messages,
          and it goes to the Library AND to OpenAI. Asking for a crop is the mitigation. On the
          campaign wizard it lives behind the (i) beside the heading (SJ-v3-01b, Edward 24 Sep) —
          the long explanation belongs in the tip, not on the page. In compact mode the host card's
          own heading carries the (i) — standing advice is never a box on the page (Edward, 24 Sep). */}
      {!compact && (
        <h2 className="org-section-heading">
          {t('campaigns.receipt.title')}
          <InfoTip
            label={t('campaigns.receipt.tipLabel')}
            title={t('campaigns.receipt.tipTitle')}
            lines={[t('campaigns.receipt.intro'), t('campaigns.receipt.cropHint')]}
            testId="receipt-crop-hint"
          />
        </h2>
      )}

      {leading !== undefined ? (
        <div className="receipt-row">
          {leading}
          <Field as="div" label={proofLabel}>{inputs}</Field>
        </div>
      ) : inputs}

      {read.isPending && (
        <p className="muted" data-testid="receipt-reading">{t('campaigns.receipt.reading')}</p>
      )}
      {error && (
        <p className="form-error" data-testid="receipt-error">{error}</p>
      )}

      {preview && (
        <img className="receipt-preview" src={preview} alt={t('campaigns.receipt.previewAlt')} data-testid="receipt-preview" />
      )}

      {/* Shown when there is evidence — a file just chosen, or one filed on a previous visit — OR
          once somebody starts entering the arrival by hand. A screenshot is EVIDENCE, and evidence
          is optional (ADR-0085 d.5): a request that came by phone, or one the model cannot read,
          still has a moment the client asked, and that moment is what starts the clock. Gating the
          whole block on an image meant no screenshot ⇒ no confirmable arrival ⇒ the clock never
          started (found 12 Sep). Now the arrival can always be recorded; the screenshot stays the
          proof when there is one. (Gating on `value.image` alone also hid the fields on a resumed
          draft, because a `File` cannot survive serialisation — I40.) */}
      {!(value.image || filedUrl || value.receivedDate || value.receivedTime || value.subject || manualEntry) && (
        <Button
          variant="link" className="receipt-manual"
          onClick={() => setManualEntry(true)}
          data-testid="receipt-manual"
        >
          {t('campaigns.receipt.manual')}
        </Button>
      )}

      {(value.image || filedUrl || value.receivedDate || value.receivedTime || value.subject || manualEntry) && (
        <div className="form-grid receipt-fields">
          <label className="form-field-wide">
            {t('campaigns.receipt.subject')}
            <input
              value={value.subject}
              onChange={(e) => edit({ subject: e.target.value }, 'subject')}
              data-testid="receipt-subject"
            />
            {marker('subject')}
          </label>
          <label>
            {t('campaigns.receipt.date')}
            <DateField
             
              value={value.receivedDate}
              onChange={(v) => edit({ receivedDate: v }, 'receivedDate')}
              data-testid="receipt-date"
            />
            {marker('receivedDate')}
          </label>
          <label>
            {t('campaigns.receipt.time')}
            <input
              type="time"
              value={value.receivedTime}
              onChange={(e) => edit({ receivedTime: e.target.value }, 'receivedTime')}
              data-testid="receipt-time"
            />
            {marker('receivedTime')}
          </label>
          <label>
            {t('campaigns.receipt.timeZone')}
            <select
              value={value.timeZone}
              onChange={(e) => edit({ timeZone: e.target.value })}
              data-testid="receipt-timezone"
            >
              {(zones.data?.options ?? [value.timeZone]).filter(Boolean).map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
            <span className="muted">{t('campaigns.receipt.timeZoneNote')}</span>
          </label>

          {/* A partial reading is the system working, not a failure — say which half is missing
              rather than showing a disabled button with no reason (d.13). */}
          {!complete && (
            <p className="muted form-field-wide" data-testid="receipt-partial">
              {t('campaigns.receipt.partial')}
            </p>
          )}

          <div className="form-field-wide">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={value.confirmed}
                disabled={!complete}
                onChange={(e) => onChange({ ...value, confirmed: e.target.checked })}
                data-testid="receipt-confirm"
              />
              {t('campaigns.receipt.confirm')}
              {/* Standing advice lives in an (i), app-wide (Edward, 24 Sep) — it sat under the tick as
                  a paragraph in a larger face than the panel. */}
              <InfoTip label={t('campaigns.receipt.confirm')} lines={[t('campaigns.receipt.confirmNote')]} testId="receipt-confirm-tip" />
            </label>
          </div>
        </div>
      )}
    </section>
  )
}
