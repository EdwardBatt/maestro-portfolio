import { describe, expect, it } from 'vitest'
import { languageName, languageWords } from './language-words'

const VALUES = [
  { code: 'en', labelEn: 'English', labelAr: 'الإنجليزية' },
  { code: 'ar', labelEn: 'Arabic', labelAr: 'العربية' },
  { code: 'ku', labelEn: 'Kurdish', labelAr: null },
]

describe('languageWords (ADR-0117 addendum, Q18) — a deliverable\'s languages in words', () => {
  it('names them from the tenant\'s list, in the order chosen', () => {
    expect(languageWords(['en', 'ar', 'ku'], VALUES, 'en')).toBe('English, Arabic, Kurdish')
    expect(languageWords(['ku', 'en'], VALUES, 'en')).toBe('Kurdish, English')
  })

  it('reads the Arabic label in Arabic, the English one where there is none, with the Arabic comma', () => {
    expect(languageWords(['ar', 'ku'], VALUES, 'ar')).toBe('العربية، Kurdish')
  })

  it('is empty with none', () => {
    expect(languageWords([], VALUES, 'en')).toBe('')
    expect(languageWords(null, VALUES, 'en')).toBe('')
  })

  it('says a code the list does not name through the browser, else as written', () => {
    expect(languageName('fr', VALUES, 'en')).toBe('French')
    expect(languageName('lang-3', VALUES, 'en')).toBe('LANG-3')
  })
})
