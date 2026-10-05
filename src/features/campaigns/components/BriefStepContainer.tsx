import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PERFORMANCE_FIELD_KEYS,
  isBriefFieldKey,
  type BriefFieldKey,
} from '../../../lib/brief/fields'
import { AddRuleDialog, type NewRule, type RuleLocale } from './AddRuleDialog'
import { TheBriefStep, type BriefPart, type BriefRule } from './TheBriefStep'

/**
 * **The brief step, wired** — the adapter between the campaign wizard's flat brief state and
 * `TheBriefStep`'s parts (Figma `CB-v3-02` / `CB-v3-P2`, `I56.5` / `I56.6`).
 *
 * `TheBriefStep` knows nothing about `WizardState`, and `BriefWizard` knows nothing about parts.
 * This is the one file that knows both, so the frame's grouping lives in exactly one place and the
 * wizard hands over what it already holds: fourteen strings, the machine-filled markers and the
 * rules.
 *
 * **The grouping is the Creative Brief's, not the state's.** `WizardState` stores fourteen fields
 * in a flat row because that is what `lib/brief/fields` sends to the model; the frame reads them as
 * *"the Creative Brief, in four parts"* — context, audience and brand, the thought, and the
 * performance flight — with the dos and don'ts as a fifth row that counts rules instead of boxes.
 * The strategy fields and the flight are deliberately NOT one part: the flight is a separate brief
 * in the agency's own deck, and a reader who has just written the proposition should see that the
 * next card asks a different kind of question.
 *
 * **Both labels come from the locale files, not from this file.** `BriefField` carries `labelEn`
 * and `labelAr` because the pair *is* the field name — the account manager types the brief in one
 * language and the client reads it in the other. So each label is read twice from the same key,
 * once pinned to `en` and once to `ar`, through `getResource` rather than `t(key, { lng })`:
 * `t` falls back to English when an Arabic key is missing, which would print the English label
 * twice and read as a translation that exists. `getResource` returns nothing, and `labelAr: null`
 * is the shape `TheBriefStep` already has for "no Arabic label yet".
 *
 * **The machine-filled marker is a strip, not a badge on the box.** ADR-0044 §5: every field the
 * ingest filled is marked *"from the brief"* until the person edits or confirms it.
 * `TheBriefStep` has no per-field slot to put that in, and it is not this task's file to reshape,
 * so the markers are collected above the parts — one chip per unreviewed field, each with the same
 * one-press **Keep**. The contract is unchanged: `onConfirmField` drops the marker, and editing the
 * field drops it through the wizard's own reducer, so a chip cannot outlive the attention it asks
 * for. (See the report on `I56.5`: an optional marker slot on `BriefField` would put it back
 * beside the box, which is where the frame draws it.)
 *
 * Presentational and pure (AGENTS.md §2): props in, callbacks out. It fetches nothing, writes
 * nothing, and decides nothing about what a field means — including the dropped file, which it
 * hands straight up.
 */

/** How one field is drawn. Everything else about it — both labels, its placeholder — is a key. */
interface FieldShape {
  /** A paragraph rather than a line. Background and the insight run long; the task does not. */
  multiline?: boolean
  /** Shares its row with the field beside it, as the frame pairs the two brand benefits. */
  halfWidth?: boolean
}

const FIELD_SHAPES: Record<BriefFieldKey, FieldShape> = {
  background: { multiline: true },
  task: {},
  beautifulProblem: {},
  // Full width, as CB-v3-02 draws them: who the work is for is a sentence, not a label.
  audiencePrimary: {},
  audienceSecondary: {},
  brandFunctionalBenefit: { halfWidth: true },
  brandEmotionalBenefit: { halfWidth: true },
  insight: { multiline: true },
  // Single-minded by definition: a line, not a paragraph. The box says so before the copy does.
  proposition: {},
  perfObjective: { multiline: true },
  perfBudget: { halfWidth: true },
  perfAudience: { halfWidth: true },
  perfGeography: { halfWidth: true },
  perfPlatforms: {},
}

/**
 * The label key each field already has in `src/locales`. The strategy nine live under
 * `campaigns.strategy`, the flight five under `campaigns.performance` — the wizard's own keys,
 * reused rather than duplicated, so the brief reads the same wherever it is shown.
 */
function labelKey(key: BriefFieldKey): string {
  return (PERFORMANCE_FIELD_KEYS as readonly string[]).includes(key)
    ? `campaigns.performance.${key}`
    : `campaigns.strategy.${key}`
}

interface PartShape {
  key: string
  number: string
  fields: readonly BriefFieldKey[]
}

/**
 * The parts, in the order somebody would explain the job (Edward, 24 Sep): why (context), who
 * (audience and brand), what we say (the idea), then where it runs and what it must achieve
 * (journey and measures). The dos and don'ts are 5 — a list of instructions, not a part of the
 * brief, which is why `TheBriefStep` flags it `isRules` and counts rules there instead.
 *
 * `I56.5` Q7 ends with each brief-template field naming its own part, edited in Admin. When that
 * lands, this constant is the ONE thing that is replaced — a template's sections mapped to the
 * same shape — and nothing above or below it moves.
 */
function partsFor(showBudget: boolean): readonly PartShape[] {
  return [
    { key: 'context', number: '1', fields: ['background', 'task', 'beautifulProblem'] },
    {
      key: 'audience',
      number: '2',
      fields: ['audiencePrimary', 'audienceSecondary', 'brandFunctionalBenefit', 'brandEmotionalBenefit'],
    },
    { key: 'idea', number: '3', fields: ['insight', 'proposition'] },
    // ADR-0050 d.5: nothing gates this part — always on screen, nothing in it mandatory. Never
    // re-gate it. The budget alone is shown only to `campaign_budget:view` (I56.18): hidden on
    // screen, not locked — it is still in the brief and an ingest still fills it.
    {
      key: 'journey',
      number: '4',
      fields: showBudget ? PERFORMANCE_FIELD_KEYS : PERFORMANCE_FIELD_KEYS.filter((f) => f !== 'perfBudget'),
    },
    { key: 'rules', number: '5', fields: [] },
  ]
}

export function BriefStepContainer({
  values,
  machineFilled,
  rules,
  ruleLocales = [],
  onFieldChange,
  onConfirmField,
  onAddRule,
  onRemoveRule,
  top = null,
  bottom = null,
  showBudget = false,
  requiredFields = [],
  missingFields = [],
  missingText = '',
  fillerWords = [],
  testId = 'brief',
}: {
  /** Every brief field the wizard holds, keyed exactly as `WizardState` keys them. */
  values: Record<BriefFieldKey, string>
  /** Fields the last ingest filled and nobody has reviewed (ADR-0044 §5). */
  machineFilled: readonly BriefFieldKey[]
  rules: BriefRule[]
  /**
   * The languages this campaign runs in, already localized. Empty falls back to the two the app
   * itself speaks — an empty set would leave "Applies in" with nothing to press and the dialog
   * permanently unsubmittable, and a screen that cannot be finished is not an option.
   */
  ruleLocales?: readonly RuleLocale[]
  onFieldChange: (key: BriefFieldKey, value: string) => void
  /** "Keep" — the field is the person's now, marker off. The value is untouched. */
  onConfirmField: (key: BriefFieldKey) => void
  onAddRule: (rule: NewRule) => void
  onRemoveRule: (id: string) => void
  /** Above the parts: the drop zone that reads a brief document, and the reference files. */
  top?: ReactNode
  /** Passed through to the brief step: cards after its parts (ADR-0117 Languages). */
  bottom?: ReactNode
  /** `campaign_budget:view` — whether the advertising budget is on screen. */
  showBudget?: boolean
  /**
   * The fields the step cannot be left without. Today that is the proposition alone — every
   * downstream brief is written from it — but the caller owns the rule, not this screen.
   */
  requiredFields?: readonly BriefFieldKey[]
  /** Fields the LAST refusal named, so the person can see which box it meant. */
  missingFields?: readonly BriefFieldKey[]
  /** What to say on a named field. One sentence, the caller's words. */
  missingText?: string
  /** ADR-0111 (I59.27): the tenant's own filler words, passed through to the warning on each field. */
  fillerWords?: readonly string[]
  testId?: string
}) {
  const { t, i18n } = useTranslation()
  const [adding, setAdding] = useState(false)

  /**
   * One locale's own words for a key, with no fallback. `t()` would answer an Arabic miss with the
   * English string, and a field whose Arabic label is its English one is worse than a field with
   * none — it looks translated.
   */
  const inLocale = (lng: string, key: string): string | null => {
    const value = i18n.getResource(lng, 'translation', key)
    return typeof value === 'string' && value.trim() !== '' ? value : null
  }

  const parts: BriefPart[] = partsFor(showBudget).map((p) => ({
    key: p.key,
    number: p.number,
    name: t(`brief.part.${p.key}`),
    isRules: p.key === 'rules' ? true : undefined,
    fields: p.fields.map((f) => {
      const key = labelKey(f)
      return {
        key: f,
        labelEn: inLocale('en', key) ?? t(key),
        labelAr: inLocale('ar', key),
        value: values[f],
        placeholder: t(`campaigns.briefPlaceholder.${f}`),
        required: requiredFields.includes(f),
        // Only while it is still empty: a refusal that stays on a field somebody has since
        // filled is a refusal they have to dismiss rather than answer.
        error: missingFields.includes(f) && values[f].trim() === '' ? missingText : null,
        // Marked on the field itself, with its own Keep (Edward, 24 Sep) — not in a strip above.
        suggested: machineFilled.includes(f),
        ...FIELD_SHAPES[f],
      }
    }),
  }))

  const locales: readonly RuleLocale[] =
    ruleLocales.length > 0
      ? ruleLocales
      : [
          { value: 'en', label: t('brief.rule.locale.en') },
          { value: 'ar', label: t('brief.rule.locale.ar') },
        ]

  return (
    <>
      <TheBriefStep
        parts={parts}
        rules={rules}
        onFieldChange={(_partKey, fieldKey, value) => {
          // Guarded rather than cast: the keys come from `PARTS`, but a field that is not one of
          // the fourteen must not reach a reducer that indexes `WizardState` by it.
          if (isBriefFieldKey(fieldKey)) onFieldChange(fieldKey, value)
        }}
        onAddRule={() => setAdding(true)}
        onRemoveRule={onRemoveRule}
        onKeepField={(fieldKey) => {
          if (isBriefFieldKey(fieldKey)) onConfirmField(fieldKey)
        }}
        top={top}
        bottom={bottom}
        note={showBudget ? null : t('brief.budgetNote')}
        fillerWords={fillerWords}
        testId={testId}
      />

      {/* The dialog's test id is not `${testId}-add-rule`: that is already the button that opens
          it, and two nodes under one test id is a test that cannot name either. */}
      {adding && (
        <AddRuleDialog
          locales={locales}
          onAdd={(rule) => {
            setAdding(false)
            onAddRule(rule)
          }}
          onCancel={() => setAdding(false)}
          testId={`${testId}-rule-dialog`}
        />
      )}
    </>
  )
}
