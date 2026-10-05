/**
 * A deliverable's languages in words (ADR-0117 addendum, 4 Oct — Q18): "English, Arabic, Kurdish", in the order chosen.
 *
 * The names are the tenant's own (`deliverable_attribute_values`, attribute `language`) — the Arabic label in the Arabic
 * interface where there is one. A code the list does not name (a language since removed, or a legacy free-text value)
 * reads through the browser's own language names, and failing that as written, upper-cased.
 */
export interface LanguageValue {
  code: string
  labelEn: string
  labelAr: string | null
}

export function languageName(code: string, values: readonly LanguageValue[], locale: 'en' | 'ar'): string {
  const hit = values.find((v) => v.code === code)
  if (hit) return (locale === 'ar' && hit.labelAr) || hit.labelEn
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code)
    if (name && name !== code) return name
  } catch {
    // An invalid tag (a free-text value) — said as written below.
  }
  return code.toUpperCase()
}

/** The words joined in the reader's language; empty when there are none. */
export function languageWords(
  codes: readonly string[] | null | undefined,
  values: readonly LanguageValue[],
  locale: 'en' | 'ar',
): string {
  return (codes ?? []).map((c) => languageName(c, values, locale)).join(locale === 'ar' ? '، ' : ', ')
}
