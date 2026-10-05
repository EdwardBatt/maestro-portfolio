import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

export const SUPPORTED_LOCALES = ['en', 'ar'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function dirFor(locale: string): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

/** Apply locale to the document — dir + lang must always move together. */
export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale
  document.documentElement.dir = dirFor(locale)
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes
  returnEmptyString: false,
})

i18n.on('languageChanged', (lng) => {
  if ((SUPPORTED_LOCALES as readonly string[]).includes(lng)) {
    applyLocale(lng as Locale)
  }
})

export default i18n
